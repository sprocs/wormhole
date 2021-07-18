const fns = require('./wormholeData')
const { documentClient } = require('./wormholeData')

beforeAll(() => {
  process.env.WORMHOLE_WS_CONNECTIONS_TABLE_NAME = 'WormholeConnections-test'
})

beforeEach(async () => {
  await documentClient
    .put({
      TableName: process.env.WORMHOLE_WS_CONNECTIONS_TABLE_NAME,
      Item: {
        connectionId: 'CLIENT_CONNECTION_ID',
        isClient: true,
        clientForHost: 'host.com',
      },
    })
    .promise()

  await documentClient
    .put({
      TableName: process.env.WORMHOLE_WS_CONNECTIONS_TABLE_NAME,
      Item: { connectionId: 'SERVER_CONNECTION_ID', isClient: false },
    })
    .promise()
})

test('getAllConnections', async () => {
  const allConnections = await fns.getAllConnections()
  expect(allConnections.length === 2)
  expect(allConnections.map((c) => c.connectionId).sort()).toStrictEqual([
    'CLIENT_CONNECTION_ID',
    'SERVER_CONNECTION_ID',
  ])
})

test('getClientConnections', async () => {
  const clientConnections = await fns.getClientConnections()
  expect(clientConnections.length === 1)
  expect(clientConnections[0].isClient).toBeTruthy()
})

test('getClientConnectionForHost', async () => {
  const clientConnection = await fns.getClientConnectionForHost('host.com')
  expect(clientConnection).toBeDefined()
  expect(clientConnection.clientForHost).toEqual('host.com')
})
