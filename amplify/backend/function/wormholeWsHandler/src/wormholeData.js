const AWS = require('aws-sdk')

const documentClient = new AWS.DynamoDB.DocumentClient({
  convertEmptyValues: true,
  ...(process.env.MOCK_DYNAMODB_ENDPOINT && {
    endpoint: process.env.MOCK_DYNAMODB_ENDPOINT,
    sslEnabled: false,
    region: 'local',
  }),
})

AWS.config.logger = console

const DEFAULT_HOST = 'DEFAULT'

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

const getClientConnectionForHost = async (clientForHost = DEFAULT_HOST) => {
  const { Items } = await documentClient
    .query({
      TableName: process.env.WORMHOLE_WS_CONNECTIONS_TABLE_NAME,
      IndexName: 'byClientForHost',
      KeyConditionExpression: 'clientForHost = :clientForHost',
      ExpressionAttributeValues: { ':clientForHost': clientForHost },
    })
    .promise()
  return Items[0]
}

const resetConnectionTtl = async (connectionId) => {
  const connectionResp = await documentClient
    .update({
      TableName: process.env.WORMHOLE_WS_CONNECTIONS_TABLE_NAME,
      Key: {
        connectionId,
      },
      UpdateExpression: `SET expiresTtl = :expiresTtl, updatedAt = :now`,
      ExpressionAttributeValues: {
        ':now': new Date().toISOString(),
        ':expiresTtl': Math.round(
          new Date(new Date().getTime() + 15 * 60000) / 1000, // 15 minutes from now
        ),
      },
      ReturnValues: 'ALL_NEW',
    })
    .promise()
  return connectionResp.Attributes
}

module.exports = {
  getClientConnections,
  getClientConnectionForHost,
  getAllConnections,
  resetConnectionTtl,
  documentClient,
}
