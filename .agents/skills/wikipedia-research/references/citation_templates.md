# Wikipedia Citation Template Reference

Guide to parsing and extracting data from Wikipedia's citation templates.

## Table of Contents
- [Reference Tag Structure](#reference-tag-structure)
- [Citation Templates Overview](#citation-templates-overview)
- [Template Parameters](#template-parameters)
- [Parsing Patterns](#parsing-patterns)
- [Edge Cases](#edge-cases)

---

## Reference Tag Structure

Wikipedia uses `<ref>` tags to mark citations:

### Basic Reference
```wikitext
<ref>Citation content here</ref>
```

### Named Reference (reusable)
```wikitext
<ref name="smith2024">{{cite journal |author=Smith |title=Paper}}</ref>
```

### Reference Reuse
```wikitext
<ref name="smith2024" />
```

### Grouped References
```wikitext
<ref group="notes">Explanatory note</ref>
```

---

## Citation Templates Overview

### Common Templates

| Template | CSL Type | Usage |
|----------|----------|-------|
| `{{cite web}}` | webpage | Websites, blogs |
| `{{cite news}}` | article-newspaper | News articles |
| `{{cite journal}}` | article-journal | Academic papers |
| `{{cite book}}` | book | Books |
| `{{cite magazine}}` | article-magazine | Magazine articles |
| `{{cite conference}}` | paper-conference | Conference papers |
| `{{cite encyclopedia}}` | entry-encyclopedia | Encyclopedia entries |
| `{{cite thesis}}` | thesis | Dissertations |
| `{{cite report}}` | report | Reports |
| `{{cite arXiv}}` | article | arXiv preprints |
| `{{citation}}` | article | Generic (auto-detects) |

---

## Template Parameters

### Universal Parameters

| Parameter | Aliases | Description |
|-----------|---------|-------------|
| `title` | - | Source title |
| `url` | `URL` | Web address |
| `access-date` | `accessdate` | When URL was accessed |
| `archive-url` | `archiveurl` | Archived version URL |
| `archive-date` | `archivedate` | Archive date |
| `url-status` | - | live, dead, usurped |
| `language` | - | Content language |
| `quote` | - | Direct quotation |

### Author Parameters

| Parameter | Aliases | Description |
|-----------|---------|-------------|
| `author` | - | Full author name |
| `last` | `last1`, `surname` | Family name |
| `first` | `first1`, `given` | Given name |
| `last2`-`last9` | - | Additional authors |
| `first2`-`first9` | - | Additional given names |
| `author-link` | `authorlink` | Wikipedia article about author |

### Date Parameters

| Parameter | Aliases | Description |
|-----------|---------|-------------|
| `date` | - | Full publication date |
| `year` | - | Publication year |
| `month` | - | Publication month |
| `orig-date` | `origyear` | Original publication date |

### Identifier Parameters

| Parameter | Description |
|-----------|-------------|
| `doi` | Digital Object Identifier |
| `pmid` | PubMed ID |
| `pmc` | PubMed Central ID |
| `isbn` | Book ISBN |
| `issn` | Serial ISSN |
| `oclc` | WorldCat number |
| `arxiv` | arXiv identifier |
| `bibcode` | Astronomy bibcode |
| `s2cid` | Semantic Scholar ID |

### Publication Parameters

| Parameter | Aliases | Description |
|-----------|---------|-------------|
| `journal` | `work`, `website` | Publication name |
| `publisher` | - | Publisher |
| `volume` | - | Volume number |
| `issue` | `number` | Issue number |
| `pages` | `page` | Page numbers |
| `edition` | - | Book edition |
| `location` | - | Publication place |

---

## Parsing Patterns

### Extract Ref Tags

```python
import re

# Match all <ref> tags with content
ref_pattern = r'<ref(?:\s+name\s*=\s*["\']?([^"\'>\s]+)["\']?)?[^>]*>(.*?)</ref>'

for match in re.finditer(ref_pattern, wikitext, re.DOTALL | re.IGNORECASE):
    ref_name = match.group(1)  # Optional name attribute
    ref_content = match.group(2)  # Citation content
```

### Extract Template Parameters

```python
def extract_template_params(content):
    """Extract key=value pairs from template."""
    params = {}

    # Match |param=value patterns
    param_pattern = r'\|\s*([a-zA-Z0-9_-]+)\s*=\s*([^|{}]*?)(?=\||}}|$)'

    for match in re.finditer(param_pattern, content, re.DOTALL):
        key = match.group(1).strip().lower()
        value = match.group(2).strip()

        # Clean wiki markup from value
        value = re.sub(r'\[\[([^\]|]+)\|?([^\]]*)\]\]',
                       lambda m: m.group(2) or m.group(1), value)
        value = re.sub(r"'''?", '', value)  # Remove bold/italic

        if value:
            params[key] = value

    return params
```

### Detect Template Type

```python
TEMPLATES = [
    'cite web', 'cite news', 'cite journal', 'cite book',
    'cite magazine', 'cite conference', 'cite encyclopedia',
    'cite thesis', 'cite report', 'cite arxiv', 'citation'
]

def detect_template_type(content):
    content_lower = content.lower()
    for template in TEMPLATES:
        if template in content_lower:
            return template
    return 'citation'  # Default
```

### Parse Authors

```python
def parse_authors(params):
    """Extract author list from template params."""
    authors = []

    # Check 'author' field
    if 'author' in params:
        author = params['author']
        if ',' in author:
            parts = author.split(',', 1)
            authors.append({
                'family': parts[0].strip(),
                'given': parts[1].strip() if len(parts) > 1 else ''
            })
        else:
            authors.append({'family': author, 'given': ''})

    # Check numbered authors (last1/first1, last2/first2, etc.)
    for i in range(1, 10):
        last_key = 'last' if i == 1 else f'last{i}'
        first_key = 'first' if i == 1 else f'first{i}'

        last = params.get(last_key, params.get(f'last{i}', ''))
        first = params.get(first_key, params.get(f'first{i}', ''))

        if last:
            authors.append({'family': last, 'given': first})

    return authors
```

### Parse Dates

```python
from datetime import datetime

def parse_date(date_str):
    """Parse date string to CSL format."""
    if not date_str:
        return None

    formats = [
        ('%Y-%m-%d', 3),      # 2024-01-15
        ('%B %d, %Y', 3),     # January 15, 2024
        ('%d %B %Y', 3),      # 15 January 2024
        ('%Y-%m', 2),         # 2024-01
        ('%B %Y', 2),         # January 2024
        ('%Y', 1),            # 2024
    ]

    for fmt, parts_count in formats:
        try:
            dt = datetime.strptime(date_str.strip(), fmt)
            date_parts = [dt.year]
            if parts_count >= 2:
                date_parts.append(dt.month)
            if parts_count >= 3:
                date_parts.append(dt.day)
            return {'date-parts': [date_parts]}
        except ValueError:
            continue

    # Fallback: extract year with regex
    year_match = re.search(r'\b(19|20)\d{2}\b', date_str)
    if year_match:
        return {'date-parts': [[int(year_match.group())]]}

    return None
```

---

## Edge Cases

### Nested Templates

Citations may contain nested templates:
```wikitext
{{cite web |title={{lang|fr|Le Monde}} |url=...}}
```

**Solution:** Process inner templates first or extract raw value.

### Wiki Links in Values

```wikitext
{{cite journal |author=[[John Smith (scientist)|John Smith]]}}
```

**Solution:** Strip `[[` and `]]`, use text after `|` if present.

### Multiple Values

Some fields may have multiple values:
```wikitext
{{cite book |author=Smith; Jones; Brown}}
```

**Solution:** Split on `;` or `and` for authors.

### Bare URLs

Some references are just URLs without templates:
```wikitext
<ref>https://example.com/article</ref>
```

**Solution:** Detect URL-only content and create minimal citation.

### Missing Templates

Plain text citations without templates:
```wikitext
<ref>Smith, J. (2024). "Paper Title". Journal Name.</ref>
```

**Solution:** Use heuristics or mark as unstructured.

### HTML Entities

Values may contain HTML entities:
```wikitext
{{cite web |title=Research &amp; Development}}
```

**Solution:** Decode HTML entities in values.

---

## Example: Full Extraction

```python
def extract_citation(ref_content, ref_id):
    """Full citation extraction from ref content."""

    # Detect template type
    template = detect_template_type(ref_content)
    csl_type = TEMPLATE_TYPE_MAP.get(template, 'article')

    # Extract parameters
    params = extract_template_params(ref_content)

    # Build CSL-JSON citation
    citation = {
        'id': ref_id,
        'type': csl_type
    }

    # Map common fields
    if params.get('title'):
        citation['title'] = params['title']
    if params.get('url'):
        citation['URL'] = params['url']
    if params.get('doi'):
        citation['DOI'] = params['doi']
    if params.get('pmid'):
        citation['PMID'] = params['pmid']
    if params.get('isbn'):
        citation['ISBN'] = params['isbn']

    # Parse complex fields
    authors = parse_authors(params)
    if authors:
        citation['author'] = authors

    issued = parse_date(params.get('date') or params.get('year'))
    if issued:
        citation['issued'] = issued

    accessed = parse_date(params.get('access-date') or params.get('accessdate'))
    if accessed:
        citation['accessed'] = accessed

    # Publication info
    container = params.get('journal') or params.get('work') or params.get('website')
    if container:
        citation['container-title'] = container

    if params.get('publisher'):
        citation['publisher'] = params['publisher']
    if params.get('volume'):
        citation['volume'] = params['volume']
    if params.get('issue') or params.get('number'):
        citation['issue'] = params.get('issue') or params.get('number')
    if params.get('pages') or params.get('page'):
        citation['page'] = params.get('pages') or params.get('page')

    return citation
```
