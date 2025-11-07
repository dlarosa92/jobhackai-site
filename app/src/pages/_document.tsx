import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="icon" type="image/png" href="/assets/jobhackai_icon_only_128.png" />
        <link rel="apple-touch-icon" href="/assets/jobhackai_icon_only_128.png" />
        <script src="/js/dynamic-favicon.js?v=20250111-1"></script>
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}

