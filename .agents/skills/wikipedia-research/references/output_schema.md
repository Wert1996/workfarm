# Output Schema Documentation

This skill outputs research data in a structured JSON format based on CSL-JSON (Citation Style Language) with added provenance tracking for AI verification.

## Table of Contents
- [Complete Output Schema](#complete-output-schema)
- [Article Object](#article-object)
- [Section Object](#section-object)
- [Claim Object](#claim-object)
- [Citation Object (CSL-JSON)](#citation-object-csl-json)
- [Provenance Object](#provenance-object)
- [Source Quality Ratings](#source-quality-ratings)

---

## Complete Output Schema

```json
{
  "article": { /* Article metadata */ },
  "sections": [ /* Content sections with claims */ ],
  "citations": [ /* CSL-JSON formatted citations */ ],
  "provenance": { /* Extraction metadata */ },
  "metadata": { /* Additional statistics */ }
}
```

---

## Article Object

Metadata about the Wikipedia article.

```json
{
  "article": {
    "title": "Article Title",
    "url": "https://en.wikipedia.org/wiki/Article_Title",
    "revision_id": "1234567890",
    "extracted_at": "2026-02-03T10:30:00Z",
    "language": "en",
    "categories": ["Category 1", "Category 2"]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Article title |
| `url` | string | Full Wikipedia URL |
| `revision_id` | string | Wikipedia revision ID for reproducibility |
| `extracted_at` | ISO 8601 | When extraction occurred |
| `language` | string | Wikipedia language code |
| `categories` | array | Article categories |

---

## Section Object

Article sections with extracted content and claims.

```json
{
  "sections": [
    {
      "heading": "Introduction",
      "level": 1,
      "content": "Plain text content of the section...",
      "claims": [ /* Claim objects */ ]
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `heading` | string | Section heading |
| `level` | int | Heading level (1-6) |
| `content` | string | Plain text content |
| `claims` | array | Extracted factual claims |

---

## Claim Object

Individual factual claims mapped to their supporting citations.

```json
{
  "claims": [
    {
      "text": "The specific factual statement extracted from the article.",
      "citation_ids": ["ref_1", "ref_2"],
      "confidence": 0.85
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `text` | string | The factual claim text |
| `citation_ids` | array | IDs of supporting citations |
| `confidence` | float | Confidence score (0-1) based on citation quality |

### Confidence Score Calculation

**Method:** Additive heuristic based on citation metadata presence.

The confidence score for a claim is the **average** of scores for all its supporting citations. Each citation is scored by summing:

| Factor | Weight | Rationale |
|--------|--------|-----------|
| Base score | 0.50 | Starting point for any citation |
| Has DOI | +0.20 | DOIs typically indicate peer-reviewed or formally published work |
| Has PMID | +0.15 | PubMed indexing indicates scientific/medical literature |
| Has ISBN | +0.10 | Published book with formal identifier |
| Has URL | +0.05 | Link exists for verification |
| Has author | +0.10 | Attributable to specific person(s) |
| Has publication venue | +0.05 | Named journal, book, or website |
| **Maximum** | **1.00** | Score capped at 1.0 |

**Example calculations:**

| Citation Type | Calculation | Score |
|---------------|-------------|-------|
| Nature paper (DOI + PMID + author + venue) | 0.50 + 0.20 + 0.15 + 0.10 + 0.05 = 1.00 | **1.00** |
| arXiv preprint (DOI + author + URL) | 0.50 + 0.20 + 0.10 + 0.05 = 0.85 | **0.85** |
| News article (URL + author + venue) | 0.50 + 0.05 + 0.10 + 0.05 = 0.70 | **0.70** |
| Bare URL | 0.50 + 0.05 = 0.55 | **0.55** |
| Citation not found in extraction | — | **0.30** |

**Limitations:**

This is a metadata-presence heuristic, NOT a semantic verification:

1. **Does not verify claim-source alignment** — A citation existing doesn't mean it supports the specific claim
2. **Does not assess source quality** — A DOI from a predatory journal scores the same as Nature
3. **Does not read the source** — No semantic analysis of cited content
4. **Assumes DOI ≈ peer-reviewed** — Preprints and datasets also have DOIs
5. **No temporal weighting** — Old sources score the same as recent ones

**For critical verification:** Use `source_verifier.py` to validate identifiers exist, then manually verify claim-source alignment.

---

## Citation Object (CSL-JSON)

Citations follow the [CSL-JSON specification](https://citeproc-js.readthedocs.io/en/latest/csl-json/markup.html) for maximum compatibility.

```json
{
  "citations": [
    {
      "id": "ref_1",
      "type": "article-journal",
      "title": "Research Paper Title",
      "author": [
        {"family": "Smith", "given": "John"},
        {"family": "Doe", "given": "Jane"}
      ],
      "URL": "https://example.com/paper",
      "DOI": "10.1234/example.2024.001",
      "PMID": "12345678",
      "ISBN": "978-0-123456-78-9",
      "issued": {
        "date-parts": [[2024, 1, 15]]
      },
      "accessed": {
        "date-parts": [[2026, 2, 3]]
      },
      "publisher": "Academic Press",
      "container-title": "Journal of Research",
      "volume": "42",
      "issue": "3",
      "page": "100-120",
      "quote": "Direct quote if available"
    }
  ]
}
```

### Citation Types

| Type | Description |
|------|-------------|
| `article` | Generic article |
| `article-journal` | Academic journal article |
| `article-newspaper` | News article |
| `article-magazine` | Magazine article |
| `book` | Book |
| `chapter` | Book chapter |
| `webpage` | Web page |
| `report` | Report |
| `thesis` | Thesis/dissertation |
| `paper-conference` | Conference paper |
| `entry-encyclopedia` | Encyclopedia entry |

### Author Format

Authors are structured as objects with family and given names:

```json
"author": [
  {"family": "Smith", "given": "John A."},
  {"family": "Organization Name", "given": ""}
]
```

### Date Format

Dates use the CSL date-parts format:

```json
"issued": {
  "date-parts": [[2024, 1, 15]]  // [year, month, day]
}
```

Partial dates are supported: `[[2024]]` (year only), `[[2024, 6]]` (year and month).

---

## Provenance Object

Tracks how the data was extracted for reproducibility.

```json
{
  "provenance": {
    "source": "Wikipedia",
    "source_url": "https://en.wikipedia.org/wiki/Article_Title",
    "extraction_method": "MediaWiki API + wikitext parsing",
    "skill_version": "1.0",
    "extracted_at": "2026-02-03T10:30:00Z"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `source` | string | Data source name |
| `source_url` | string | Original source URL |
| `extraction_method` | string | How data was extracted |
| `skill_version` | string | Skill version used |
| `extracted_at` | ISO 8601 | Extraction timestamp |

---

## Source Quality Ratings

Research output includes source quality assessment using the Admiralty Code system.

```json
{
  "source_quality": {
    "rating": "B",
    "score": 0.72,
    "breakdown": {
      "has_doi": 45.0,
      "has_url": 85.0,
      "has_author": 60.0,
      "has_date": 70.0,
      "peer_reviewed": 40.0,
      "accessible": 85.0
    }
  }
}
```

### Rating Scale

| Rating | Score Range | Meaning |
|--------|-------------|---------|
| A | 0.80 - 1.00 | Completely reliable |
| B | 0.60 - 0.79 | Usually reliable |
| C | 0.40 - 0.59 | Fairly reliable |
| D | 0.20 - 0.39 | Not usually reliable |
| E | 0.00 - 0.19 | Unreliable |
| F | N/A | Cannot be judged |

---

## Multi-Article Research Schema

When researching multiple articles, additional fields are included:

```json
{
  "research_query": "artificial intelligence",
  "research_date": "2026-02-03T10:30:00Z",
  "summary": {
    "articles_analyzed": 5,
    "total_citations": 150,
    "total_claims_extracted": 85,
    "cross_referenced_citations": 12,
    "source_quality": { /* Rating object */ }
  },
  "articles": [ /* Individual article objects */ ],
  "all_citations": [ /* Deduplicated citations */ ],
  "cross_referenced_citations": [
    {
      "citation": { /* CSL-JSON citation */ },
      "used_in": ["Article 1", "Article 2"],
      "usage_count": 2
    }
  ],
  "provenance": { /* Provenance object */ }
}
```

---

## Verification Result Schema

For claim verification results:

```json
{
  "claim": "The claim being verified",
  "verification_score": 0.75,
  "status": "supported",
  "supporting_evidence": [
    {
      "article": "Article Title",
      "section": "Section Name",
      "text": "Supporting text from article",
      "citation_ids": ["ref_1"],
      "confidence": 0.85,
      "relevance": 0.70,
      "citations": [ /* Full citation objects */ ]
    }
  ],
  "related_content": [ /* Tangentially related evidence */ ],
  "articles_checked": ["Article 1", "Article 2"],
  "verified_at": "2026-02-03T10:30:00Z"
}
```

### Verification Status Values

| Status | Score Range | Meaning |
|--------|-------------|---------|
| `strongly_supported` | 0.80+ | Strong evidence supports claim |
| `supported` | 0.60-0.79 | Evidence supports claim |
| `partially_supported` | 0.40-0.59 | Some supporting evidence |
| `weakly_supported` | 0.20-0.39 | Weak evidence only |
| `insufficient_evidence` | <0.20 | Not enough evidence found |
