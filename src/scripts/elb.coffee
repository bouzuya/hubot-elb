# Description
#   A Hubot script to manage the Elastic Load Balancing
#
# Configuration:
#   HUBOT_ELB_ACCOUNTS
#   HUBOT_ELB_<xxx>_ACCESS_KEY_ID
#   HUBOT_ELB_<xxx>_SECRET_ACCESS_KEY
#   HUBOT_ELB_<xxx>_REGION
#
# Commands:
#   hubot elb <account> - list the ELB statuses
#
# Author:
#   bouzuya <m@bouzuya.net>
#
{Promise} = require 'es6-promise'
AWS = require 'aws-sdk'
Case = require 'case'

module.exports = (robot) ->
  accounts = (process.env.HUBOT_ELB_ACCOUNTS || '')
    .split ','
    .filter (i) -> i.length > 0
    .reduce (as, i) ->
      as[i] = ['ACCESS_KEY_ID', 'SECRET_ACCESS_KEY', 'REGION'].reduce (a, j) ->
        a[Case.camel(j)] = process.env['HUBOT_ELB_' + i.toUpperCase() + '_' + j]
        a
      , {}
      as
    , {}

  formatELBs = (elbs) ->
    loadBalancers = elbs.map (i) ->
      instances = i.Instances.map (j) ->
        "    #{j.InstanceId}: #{j.State} (#{j.ReasonCode})"
      """
      #{i.LoadBalancerName}:
      #{instances.join('\n')}
      """
    """
    ELBs:
    #{loadBalancers.join('\n')}
    """

  newClient = (account) ->
    new AWS.ELB
      apiVersion: '2012-06-01'
      accessKeyId: account.accessKeyId
      secretAccessKey: account.secretAccessKey
      region: account.region ? 'ap-northeast-1'

  listLoadBalancers = (client) ->
    # promised describeLoadBalancers
    new Promise (resolve, reject) ->
      client.describeLoadBalancers {}, (err, data) ->
        return reject(err) if err
        resolve data.LoadBalancerDescriptions

  listInstances = (client, elb) ->
    # promised describeInstanceHealth
    new Promise (resolve, reject) ->
      params =
        LoadBalancerName: elb.LoadBalancerName
        Instances: elb.Instances.map (i) -> { InstanceId: i.InstanceId }
      client.describeInstanceHealth params, (err, data) ->
        return reject(err) if err
        resolve(data.InstanceStates)

  listELBs = (account) ->
    # describeLoadBalancers & describeInstanceHealth
    client = newClient account
    listLoadBalancers client
    .then (elbs) ->
      # add instance statuses to elb.Instances
      elbs.reduce(((promise, elb) ->
        promise.then ->
          listInstances client, elb
        .then (result) ->
          elb.Instances = elb.Instances.map (i) ->
            result.filter((j) -> i.InstanceId is j.InstanceId)[0]
        .then ->
          elbs
      ), Promise.resolve())

  deregisterInstances = (client, loadBalancerName, instances) ->
    # promised deregisterInstancesFromLoadBalancer
    new Promise (resolve, reject) ->
      params =
        Instances: instances.map (i) -> { InstanceId: i.InstanceId }
        LoadBalancerName: loadBalancerName
      client.deregisterInstancesFromLoadBalancer params, (err, data) ->
        return reject(err) if err
        resolve(data.Instances)

  registerInstances = (client, loadBalancerName, instances) ->
    # promised registerInstancesToLoadBalancer
    new Promise (resolve, reject) ->
      params =
        Instances: instances.map (i) -> { InstanceId: i.InstanceId }
        LoadBalancerName: loadBalancerName
      client.registerInstancesWithLoadBalancer params, (err, data) ->
        return reject(err) if err
        resolve(data.Instances)

  error = (res, e) ->
    res.robot.logger.error 'hubot-elb: error'
    res.robot.logger.error e
    res.send 'hubot-elb: error'

  status = (res, account) ->
    listELBs account
    .then formatELBs
    .then (message) ->
      res.send message
    .catch (e) ->
      error res, e

  robot.respond /elb\s+([-\w]+)$/i, (res) ->
    accountId = res.match[1]
    account = accounts[accountId]
    return res.send("account #{accountId} is not found") unless account?
    res.send 'elb status ' + accountId
    status res, account
