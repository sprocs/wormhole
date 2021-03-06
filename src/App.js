import React from 'react'
import Logo from './Logo'
import { CopyToClipboard } from 'react-copy-to-clipboard'
import "./App.css"
import packageJson from '../package.json'
import awsExports from './aws-exports.js'

const App = () => {
  const [copied, setCopied] = React.useState(false)
  const wormholeApiEndpoint = React.useMemo(() => {
    return awsExports.aws_cloud_logic_custom.find((api) => {
      return api.name === 'wormholeApi'
    })?.endpoint
  }, [])
  const npxCmd = `npx @sprocs/wormhole listen ${wormholeApiEndpoint} 3000`

  return <main className="container">
    <div className="logoContainer">
      <Logo />
    </div>

    <p>Your wormhole endpoint is deployed at <a href={wormholeApiEndpoint}>{wormholeApiEndpoint}</a></p>
    <p>Get started by connecting a wormhole client with <a href="https://www.npmjs.com/package/npx">npx</a> (example below, requires <a href="https://nodejs.org/en/download/">node.js</a>/<a href="https://npmjs.com/">npm</a> to be installed) or refer to the <a href="https://github.com/sprocs/wormhole">wormhole docs</a> for help.</p>

    <div className="copyCommand">
      <input value={npxCmd} readOnly />
      <CopyToClipboard text={npxCmd} onCopy={() => setCopied(true)}>
        <button type="button" className={copied ? 'active' : ''} title="copy command">
          {!copied && (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              fill="currentColor"
              viewBox="0 0 16 16">
              <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z" />
              <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z" />
            </svg>
          )}
          {copied && (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              fill="currentColor"
              viewBox="0 0 16 16">
              <path
                fillRule="evenodd"
                d="M10.854 7.146a.5.5 0 0 1 0 .708l-3 3a.5.5 0 0 1-.708 0l-1.5-1.5a.5.5 0 1 1 .708-.708L7.5 9.793l2.646-2.647a.5.5 0 0 1 .708 0z"
              />
              <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z" />
              <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z" />
            </svg>
          )}
        </button>
      </CopyToClipboard>
    </div>
    <footer>
      <div>version {packageJson.version}</div>
      <div>powered by <a href="https://sprocs.com" rel="nofollow noreferrer">sprocs</a> ??? serverless apps for aws</div>
    </footer>
  </main>
}

export default App
