# PDF Parse Service

A simple microservice for extracting text from PDF files. Designed to work with Cloudflare Workers.

## Quick Start

### Node.js Version

```bash
npm install
npm start
```

### Python Version

```bash
pip install -r requirements.txt
python server.py
```

## API

### POST /parse-pdf

Extracts text from a PDF file.

**Headers:**
- `Content-Type: application/pdf`
- `X-API-Key: <your-api-key>` (required)

**Body:** Raw PDF bytes

**Success Response (200):**
```json
{
  "success": true,
  "text": "extracted text content...",
  "numPages": 2,
  "wordCount": 450,
  "metadata": {
    "fileName": "resume.pdf",
    "fileSize": 12345
  }
}
```

**Error Response (400/500):**
```json
{
  "success": false,
  "error": "parse_error",
  "message": "PDF could not be parsed",
  "details": {
    "errorCode": "corrupted_pdf"
  }
}
```

## Environment Variables

- `PORT`: Server port (default: 3000)
- `API_KEY`: Authentication key (required)
- `MAX_FILE_SIZE`: Max PDF size in bytes (default: 2097152 = 2MB)
- `TIMEOUT_MS`: Parse timeout in milliseconds (default: 30000)

## Deployment

### Render

1. Connect GitHub repository
2. Set environment variables
3. Deploy

### Railway

1. Create new project
2. Connect repository
3. Set environment variables
4. Deploy

### Fly.io

```bash
fly launch
fly secrets set API_KEY=your-key
fly deploy
```

## Security

- API key authentication required
- File size limits enforced
- Timeout protection
- Input validation

## Health Check

`GET /health` - Returns service status

