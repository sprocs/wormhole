const AWS = require('aws-sdk')

const documentClient = new AWS.DynamoDB.DocumentClient({
  convertEmptyValues: true,
})

AWS.config.logger = console

const DEFAULT_HOST = "DEFAULT"

const getAllConnections = async () => {
  const { Items } = await documentClient
    .scan({
      TableName: process.env.WORMHOLE_WS_CONNECTIONS_TABLE_NAME,
    })
    .promise()
  return Items
}

const getClientConnections = async () => {
  const { Items } = await documentClient
    .scan({
      TableName: process.env.WORMHOLE_WS_CONNECTIONS_TABLE_NAME,
      FilterExpression: 'isClient = :isClient',
      ExpressionAttributeValues: { ':isClient': true },
    })
    .promise()
  return Items
}

const getClientConnectionForHost = async (clientForHost=DEFAULT_HOST) => {
  const { Items } = await documentClient
    .query({
      TableName: process.env.WORMHOLE_WS_CONNECTIONS_TABLE_NAME,
      IndexName: "byClientForHost",
      KeyConditionExpression: 'clientForHost = :clientForHost',
      ExpressionAttributeValues: { ':clientForHost': clientForHost },
    })
    .promise()
  return Items[0]
}

module.exports = {
  getClientConnections,
  getClientConnectionForHost,
  getAllConnections,
}
