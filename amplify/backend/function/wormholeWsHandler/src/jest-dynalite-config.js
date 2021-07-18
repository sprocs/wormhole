module.exports = {
  tables: [
    {
      TableName: 'WormholeConnections-test',
      KeySchema: [{ AttributeName: 'connectionId', KeyType: 'HASH' }],
      AttributeDefinitions: [
        { AttributeName: 'connectionId', AttributeType: 'S' },
        { AttributeName: 'clientForHost', AttributeType: 'S' },
      ],
      ProvisionedThroughput: { ReadCapacityUnits: 1, WriteCapacityUnits: 1 },
      GlobalSecondaryIndexes: [
        {
          IndexName: "byClientForHost",
          KeySchema: [
            {
              AttributeName : "clientForHost",
              KeyType : "HASH"
            }
          ],
          Projection: {
            ProjectionType: "ALL"
          }
        }
      ],
    },
  ],
}
