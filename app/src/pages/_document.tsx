import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="icon" type="image/png" href="/assets/JobHackAI_Logo_favicon-32x32.png" />
        <link rel="apple-touch-icon" href="/assets/JobHackAI_Logo_favicon-32x32.png" />
        <script src="/js/dynamic-favicon.js?v=20260418-1"></script>
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
