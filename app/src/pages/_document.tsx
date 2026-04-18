import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="icon" type="image/png" sizes="128x128" href="/assets/jobhackai_icon_Favicon_128.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/assets/jobhackai_apple_touch_icon_180.png" />
        <script src="/js/dynamic-favicon.js?v=20260418-3"></script>
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
