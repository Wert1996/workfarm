# Wikipedia MediaWiki API Reference

Quick reference for Wikipedia's Action API used by this skill.

## Table of Contents
- [Base URL](#base-url)
- [Authentication](#authentication)
- [Core Endpoints](#core-endpoints)
- [Rate Limits](#rate-limits)
- [Error Handling](#error-handling)
- [Pagination](#pagination)

---

## Base URL

```
https://{lang}.wikipedia.org/w/api.php
```

Replace `{lang}` with language code: `en`, `de`, `fr`, `es`, `ja`, etc.

## Authentication

**Not required for read-only operations.** All research operations are read-only.

**Required:** User-Agent header identifying your application:
```
User-Agent: YourApp/1.0 (https://yoursite.com; contact@email.com)
```

---

## Core Endpoints

### Search (`action=query&list=search`)

Search for Wikipedia articles.

```
GET /w/api.php?action=query&list=search&srsearch=QUERY&format=json
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `srsearch` | string | Search query |
| `srlimit` | int | Max results (1-500, default 10) |
| `srnamespace` | int | Namespace (0 = articles) |
| `srprop` | string | Properties: snippet, titlesnippet, size, wordcount, timestamp |
| `sroffset` | int | Pagination offset |

**Response:**
```json
{
  "query": {
    "search": [
      {
        "title": "Article Title",
        "pageid": 12345,
        "snippet": "...matched text...",
        "size": 50000,
        "wordcount": 5000,
        "timestamp": "2024-01-15T10:30:00Z"
      }
    ]
  }
}
```

---

### Parse Article (`action=parse`)

Get article content in HTML or wikitext.

```
GET /w/api.php?action=parse&page=TITLE&prop=text|wikitext|sections&format=json
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | string | Article title |
| `prop` | string | Properties to return (pipe-separated) |
| `section` | int | Specific section number |
| `disableeditsection` | bool | Remove edit links |

**Prop values:**
- `text` - Parsed HTML
- `wikitext` - Raw wikitext (for citation parsing)
- `sections` - Section structure
- `categories` - Article categories
- `links` - Internal links
- `externallinks` - External URLs
- `revid` - Revision ID

**Response:**
```json
{
  "parse": {
    "title": "Article Title",
    "pageid": 12345,
    "revid": 1234567890,
    "text": {"*": "<html content>"},
    "wikitext": {"*": "raw wikitext"},
    "sections": [
      {"toclevel": 1, "level": "2", "line": "History", "anchor": "History"}
    ],
    "categories": [{"*": "Category name"}],
    "links": [{"ns": 0, "*": "Linked Article"}],
    "externallinks": ["https://example.com"]
  }
}
```

---

### Query Properties (`action=query&prop=...`)

Get metadata for specific pages.

```
GET /w/api.php?action=query&titles=TITLE&prop=PROPS&format=json
```

**Common prop combinations:**

| Props | Description |
|-------|-------------|
| `revisions&rvprop=ids\|timestamp\|user` | Revision info |
| `categories&cllimit=500` | All categories |
| `links&pllimit=500` | Internal links |
| `extracts&explaintext=true` | Plain text extract |
| `info` | Page metadata |

---

### Get Backlinks (`action=query&list=backlinks`)

Find pages that link to a specific page.

```
GET /w/api.php?action=query&list=backlinks&bltitle=TITLE&bllimit=100&format=json
```

---

## Rate Limits

| Operation | Limit |
|-----------|-------|
| Read requests | Generally unlimited, be respectful |
| Recommended | 1 request/second for burst, much lower for sustained |
| OAuth users | 5,000 requests/hour |

**Best practices:**
1. Set descriptive User-Agent
2. Cache responses (1 hour minimum for article content)
3. Batch requests when possible
4. Use `continue` token for pagination

---

## Error Handling

**Error response format:**
```json
{
  "error": {
    "code": "error_code",
    "info": "Human readable message",
    "*": "Additional details"
  }
}
```

**Common errors:**

| Code | Meaning |
|------|---------|
| `missingtitle` | Page doesn't exist |
| `invalidtitle` | Invalid page title |
| `ratelimited` | Too many requests |
| `maxlag` | Server overloaded |

---

## Pagination

Large result sets return a `continue` object:

```json
{
  "continue": {
    "sroffset": 10,
    "continue": "-||"
  },
  "query": {...}
}
```

**To get next page:**
Add all values from `continue` to next request:
```
&sroffset=10&continue=-||
```

---

## Wikidata SPARQL

For structured data queries:

```
GET https://query.wikidata.org/sparql?query=SPARQL&format=json
```

**Example - Get entity by Wikipedia title:**
```sparql
SELECT ?item WHERE {
  ?article schema:about ?item ;
           schema:isPartOf <https://en.wikipedia.org/> ;
           schema:name "Article Title"@en .
}
```

---

## Quick Examples

**Search:**
```bash
curl "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=machine+learning&srlimit=5&format=json"
```

**Get article with citations:**
```bash
curl "https://en.wikipedia.org/w/api.php?action=parse&page=Machine_learning&prop=wikitext|sections&format=json"
```

**Get categories:**
```bash
curl "https://en.wikipedia.org/w/api.php?action=query&titles=Machine_learning&prop=categories&cllimit=50&format=json"
```
