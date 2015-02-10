// Description
//   A Hubot script to manage the Elastic Load Balancing
//
// Configuration:
//   HUBOT_ELB_ACCOUNTS
//   HUBOT_ELB_<xxx>_ACCESS_KEY_ID
//   HUBOT_ELB_<xxx>_SECRET_ACCESS_KEY
//   HUBOT_ELB_<xxx>_REGION
//
// Commands:
//   hubot elb <account> - list the ELB statuses
//
// Author:
//   bouzuya <m@bouzuya.net>
//
var AWS, Case, Promise;

Promise = require('es6-promise').Promise;

AWS = require('aws-sdk');

Case = require('case');

module.exports = function(robot) {
  var accounts, deregisterInstances, error, formatELBs, listELBs, listInstances, listLoadBalancers, newClient, registerInstances, status;
  accounts = (process.env.HUBOT_ELB_ACCOUNTS || '').split(',').filter(function(i) {
    return i.length > 0;
  }).reduce(function(as, i) {
    as[i] = ['ACCESS_KEY_ID', 'SECRET_ACCESS_KEY', 'REGION'].reduce(function(a, j) {
      a[Case.camel(j)] = process.env['HUBOT_ELB_' + i.toUpperCase() + '_' + j];
      return a;
    }, {});
    return as;
  }, {});
  formatELBs = function(elbs) {
    var loadBalancers;
    loadBalancers = elbs.map(function(i) {
      var instances;
      instances = i.Instances.map(function(j) {
        return "    " + j.InstanceId + ": " + j.State + " (" + j.ReasonCode + ")";
      });
      return i.LoadBalancerName + ":\n" + (instances.join('\n'));
    });
    return "ELBs:\n" + (loadBalancers.join('\n'));
  };
  newClient = function(account) {
    var _ref;
    return new AWS.ELB({
      apiVersion: '2012-06-01',
      accessKeyId: account.accessKeyId,
      secretAccessKey: account.secretAccessKey,
      region: (_ref = account.region) != null ? _ref : 'ap-northeast-1'
    });
  };
  listLoadBalancers = function(client) {
    return new Promise(function(resolve, reject) {
      return client.describeLoadBalancers({}, function(err, data) {
        if (err) {
          return reject(err);
        }
        return resolve(data.LoadBalancerDescriptions);
      });
    });
  };
  listInstances = function(client, elb) {
    return new Promise(function(resolve, reject) {
      var params;
      params = {
        LoadBalancerName: elb.LoadBalancerName,
        Instances: elb.Instances.map(function(i) {
          return {
            InstanceId: i.InstanceId
          };
        })
      };
      return client.describeInstanceHealth(params, function(err, data) {
        if (err) {
          return reject(err);
        }
        return resolve(data.InstanceStates);
      });
    });
  };
  listELBs = function(account) {
    var client;
    client = newClient(account);
    return listLoadBalancers(client).then(function(elbs) {
      return elbs.reduce((function(promise, elb) {
        return promise.then(function() {
          return listInstances(client, elb);
        }).then(function(result) {
          return elb.Instances = elb.Instances.map(function(i) {
            return result.filter(function(j) {
              return i.InstanceId === j.InstanceId;
            })[0];
          });
        }).then(function() {
          return elbs;
        });
      }), Promise.resolve());
    });
  };
  deregisterInstances = function(client, loadBalancerName, instances) {
    return new Promise(function(resolve, reject) {
      var params;
      params = {
        Instances: instances.map(function(i) {
          return {
            InstanceId: i.InstanceId
          };
        }),
        LoadBalancerName: loadBalancerName
      };
      return client.deregisterInstancesFromLoadBalancer(params, function(err, data) {
        if (err) {
          return reject(err);
        }
        return resolve(data.Instances);
      });
    });
  };
  registerInstances = function(client, loadBalancerName, instances) {
    return new Promise(function(resolve, reject) {
      var params;
      params = {
        Instances: instances.map(function(i) {
          return {
            InstanceId: i.InstanceId
          };
        }),
        LoadBalancerName: loadBalancerName
      };
      return client.registerInstancesWithLoadBalancer(params, function(err, data) {
        if (err) {
          return reject(err);
        }
        return resolve(data.Instances);
      });
    });
  };
  error = function(res, e) {
    res.robot.logger.error('hubot-elb: error');
    res.robot.logger.error(e);
    return res.send('hubot-elb: error');
  };
  status = function(res, account) {
    return listELBs(account).then(formatELBs).then(function(message) {
      return res.send(message);
    })["catch"](function(e) {
      return error(res, e);
    });
  };
  return robot.respond(/elb\s+([-\w]+)$/i, function(res) {
    var account, accountId;
    accountId = res.match[1];
    account = accounts[accountId];
    if (account == null) {
      return res.send("account " + accountId + " is not found");
    }
    res.send('elb status ' + accountId);
    return status(res, account);
  });
};
