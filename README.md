<p align="center">
  <img width="100%" src="https://sprocs-assets.s3.us-east-2.amazonaws.com/wormhole.png" />
</p>

wormhole is a **serverless local tunnel** that uses API Gateway (HTTP and WebSocket), Lambda, DynamoDB, and S3 to
proxy web requests such as webhooks or API requests to your local environment for testing/development purposes.

- **Easy-to-deploy**: one-click deployment with AWS Amplify
- **Control your traffic**: keep your development requests within your own cloud infrastructure, know who has access
- **Multiple hosts/clients**: setup unlimited custom subdomains for multiple clients
- **HTTP auth support**: setup HTTP auth to protect your public endpoint

Some use cases:
- Developing mobile apps with local APIs
- Developing with webhooks from third party services (Twilio, GitHub, etc.)
- Client demos

## Getting Started

[![amplifybutton](https://oneclick.amplifyapp.com/button.svg)](https://console.aws.amazon.com/amplify/home#/deploy?repo=https://github.com/sprocs/wormhole)

After deployment, run the client locally with your newly setup HTTP API Gateway
endpoint (or custom subdomain) as the first argument and local http port to proxy to as the second argument:

```
AWS_PROFILE=my-aws-profile npx @sprocs/wormhole listen https://my-api-gateway-id.execute-api.us-east-2.amazonaws.com 3000
```

## AWS profile/credentials

## Custom subdomains

## Architecture

## AWS pricing

## License

Server side code is licensed under the Server Side Public License ([SSPL](https://en.wikipedia.org/wiki/Server_Side_Public_License)). Please see [LICENSE](https://github.com/sprocs/wormhole/blob/master/LICENSE.txt) for details.

Client side code is licensed under [ISC](https://opensource.org/licenses/ISC)
