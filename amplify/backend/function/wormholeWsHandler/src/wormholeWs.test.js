const fns = require('./wormholeWs')
const { documentClient } = require('./wormholeData')

beforeAll(() => {
  process.env.WORMHOLE_WS_CONNECTIONS_TABLE_NAME = 'WormholeConnections-test'
})

test('handleWs bad routeKey', (done) => {
  fns.handleWs(
    {
      requestContext: {
        routeKey: '$bad',
      },
    },
    {},
    (err) => {
      expect(err).toBe('Invalid routeKey')
      done()
    },
  )
})

test('handleWs $connect for client', (done) => {
  fns.handleWs(
    {
      requestContext: {
        routeKey: '$connect',
        connectionId: 'CONNECTION_ID',
        identity: {
          sourceIp: '1.1.1.1',
        },
      },
      queryStringParameters: {
        clientForHost: 'host.com',
        clientType: 'CLIENT',
      },
    },
    {},
    async (err) => {
      expect(err).toBe(null)
      const { Item } = await documentClient
        .get({
          TableName: process.env.WORMHOLE_WS_CONNECTIONS_TABLE_NAME,
          Key: { connectionId: 'CONNECTION_ID' },
        })
        .promise()

      expect(Item).toEqual(
        expect.objectContaining({
          sourceIp: '1.1.1.1',
          isClient: true,
          clientForHost: 'host.com',
        }),
      )
      done()
    },
  )
})

jest.mock('aws-sdk', () => {
  return {
    ...jest.requireActual('aws-sdk'),
    ApiGatewayManagementApi: jest.fn(),
  }
})
const { ApiGatewayManagementApi } = require('aws-sdk')

describe('handleWs $disconnect', () => {
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

  test('handleWs $disconnect for server', (done) => {
    ApiGatewayManagementApi.mockImplementation(() => {
      return {
        postToConnection(obj) {
          expect(obj).toEqual(
            expect.objectContaining({
              ConnectionId: 'SERVER_CONNECTION_ID',
            }),
          )
          return {
            promise: () => {
              return new Promise((resolve) => resolve())
            },
          }
        },
      }
    })

    fns.handleWs(
      {
        requestContext: {
          routeKey: '$disconnect',
          connectionId: 'CLIENT_CONNECTION_ID',
        },
      },
      {},
      async (err) => {
        expect(err).toBe(null)
        const { Item } = await documentClient
          .get({
            TableName: process.env.WORMHOLE_WS_CONNECTIONS_TABLE_NAME,
            Key: { connectionId: 'CLIENT_CONNECTION_ID' },
          })
          .promise()
        expect(Item).toBeUndefined()
        done()
      },
    )
  })
})

test('handleWs sendmessage', (done) => {
  ApiGatewayManagementApi.mockImplementation(() => {
    return {
      postToConnection(obj) {
        expect(obj).toEqual(
          expect.objectContaining({
            ConnectionId: 'DEST_CONNECTION_ID',
            Data: JSON.stringify({
              sourceConnectionId: 'SOURCE_CONNECTION_ID',
              data: 'DATA',
            }),
          }),
        )
        return {
          promise: () => {
            return new Promise((resolve) => resolve())
          },
        }
      },
    }
  })

  fns.handleWs(
    {
      body: JSON.stringify({
        action: 'ACTION',
        connectionId: 'DEST_CONNECTION_ID',
        data: 'DATA',
      }),
      requestContext: {
        routeKey: 'sendmessage',
        connectionId: 'SOURCE_CONNECTION_ID',
      },
    },
    {},
    async (err) => {
      expect(err).toBe(null)
      done()
    },
  )
})

test('handleWs PING', (done) => {
  ApiGatewayManagementApi.mockImplementation(() => {
    return {
      postToConnection(obj) {
        expect(obj).toEqual(
          expect.objectContaining({
            ConnectionId: 'SOURCE_CONNECTION_ID',
            Data: JSON.stringify({
              action: 'PONG'
            }),
          }),
        )
        return {
          promise: () => {
            return new Promise((resolve) => resolve())
          },
        }
      },
    }
  })

  fns.handleWs(
    {
      body: JSON.stringify({
        data: {
          action: 'PING'
        },
      }),
      requestContext: {
        routeKey: 'sendmessage',
        connectionId: 'SOURCE_CONNECTION_ID',
      },
    },
    {},
    async (err) => {
      expect(err).toBe(null)
      done()
    },
  )
})
