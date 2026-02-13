#!/usr/bin/env python3
"""
Wikipedia Citation Extractor
Extracts and parses citations from Wikipedia articles into structured CSL-JSON format.
Maps claims to their supporting citations for AI verification.
"""

import re
import json
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any
from html.parser import HTMLParser
from dataclasses import dataclass, asdict

# Import local client
try:
    from .wikipedia_client import WikipediaClient
except ImportError:
    from wikipedia_client import WikipediaClient


@dataclass
class Citation:
    """Structured citation in CSL-JSON compatible format."""
    id: str
    type: str  # article, book, webpage, etc.
    title: Optional[str] = None
    author: Optional[List[Dict[str, str]]] = None  # [{"family": "", "given": ""}]
    URL: Optional[str] = None
    DOI: Optional[str] = None
    ISBN: Optional[str] = None
    PMID: Optional[str] = None
    issued: Optional[Dict] = None  # {"date-parts": [[year, month, day]]}
    accessed: Optional[Dict] = None
    publisher: Optional[str] = None
    container_title: Optional[str] = None  # journal/website name
    volume: Optional[str] = None
    issue: Optional[str] = None
    page: Optional[str] = None
    quote: Optional[str] = None
    language: Optional[str] = None
    archive_url: Optional[str] = None
    raw_citation: Optional[str] = None  # Original wikitext


@dataclass
class Claim:
    """A factual claim with its supporting citations."""
    text: str
    citation_ids: List[str]
    section: str
    confidence: float = 0.0  # 0-1, based on citation quality


@dataclass
class Section:
    """Article section with content and claims."""
    heading: str
    level: int
    content: str
    claims: List[Claim]


class CitationExtractor:
    """Extract and parse Wikipedia citations."""

    # Citation template patterns
    CITE_TEMPLATES = [
        'cite web', 'cite news', 'cite journal', 'cite book',
        'cite magazine', 'cite conference', 'cite encyclopedia',
        'cite thesis', 'cite report', 'cite press release',
        'cite arXiv', 'cite AV media', 'citation'
    ]

    # Map Wikipedia cite templates to CSL types
    TYPE_MAP = {
        'cite web': 'webpage',
        'cite news': 'article-newspaper',
        'cite journal': 'article-journal',
        'cite book': 'book',
        'cite magazine': 'article-magazine',
        'cite conference': 'paper-conference',
        'cite encyclopedia': 'entry-encyclopedia',
        'cite thesis': 'thesis',
        'cite report': 'report',
        'cite press release': 'article',
        'cite arXiv': 'article',
        'cite AV media': 'broadcast',
        'citation': 'article'
    }

    def __init__(self, language: str = "en"):
        """Initialize extractor with Wikipedia client."""
        self.client = WikipediaClient(language=language)
        self.language = language

    def extract_article(self, title: str) -> Dict[str, Any]:
        """
        Extract complete article with citations mapped to claims.

        Args:
            title: Wikipedia article title

        Returns:
            Structured research data with sections, claims, and citations
        """
        # Get article with wikitext for citation parsing
        article = self.client.get_article(title, include_wikitext=True)

        # Extract citations from wikitext
        citations = self._extract_citations_from_wikitext(article.get('wikitext', ''))

        # Parse sections and map claims to citations
        sections = self._parse_sections(
            article.get('html', ''),
            article.get('sections', []),
            citations
        )

        # Build output structure
        return {
            "article": {
                "title": article['title'],
                "url": article['url'],
                "revision_id": str(article.get('revid', '')),
                "extracted_at": article.get('extracted_at', datetime.now().isoformat()),
                "language": self.language,
                "categories": article.get('categories', [])
            },
            "sections": [self._section_to_dict(s) for s in sections],
            "citations": [self._citation_to_csl(c) for c in citations.values()],
            "provenance": {
                "source": "Wikipedia",
                "source_url": article['url'],
                "extraction_method": "MediaWiki API + wikitext parsing",
                "skill_version": "1.0",
                "extracted_at": datetime.now().isoformat()
            },
            "metadata": {
                "total_citations": len(citations),
                "total_sections": len(sections),
                "external_links": article.get('external_links', [])
            }
        }

    def extract_citations(self, title: str) -> List[Dict]:
        """
        Extract only citations from an article.

        Args:
            title: Wikipedia article title

        Returns:
            List of citations in CSL-JSON format
        """
        article = self.client.get_article(title, include_wikitext=True)
        citations = self._extract_citations_from_wikitext(article.get('wikitext', ''))
        return [self._citation_to_csl(c) for c in citations.values()]

    def extract_section(self, title: str, section_name: str) -> Optional[Dict]:
        """
        Extract a specific section with its citations.

        Args:
            title: Wikipedia article title
            section_name: Section heading to extract

        Returns:
            Section data with claims and citations
        """
        full_data = self.extract_article(title)

        for section in full_data['sections']:
            if section['heading'].lower() == section_name.lower():
                # Filter citations to only those referenced in this section
                section_citation_ids = set()
                for claim in section.get('claims', []):
                    section_citation_ids.update(claim.get('citation_ids', []))

                section_citations = [
                    c for c in full_data['citations']
                    if c.get('id') in section_citation_ids
                ]

                return {
                    "section": section,
                    "citations": section_citations,
                    "article": full_data['article'],
                    "provenance": full_data['provenance']
                }

        return None

    def _extract_citations_from_wikitext(self, wikitext: str) -> Dict[str, Citation]:
        """
        Parse wikitext to extract all citations.

        Args:
            wikitext: Raw wikitext content

        Returns:
            Dictionary mapping citation IDs to Citation objects
        """
        citations = {}

        # Pattern to match <ref> tags
        ref_pattern = r'<ref(?:\s+name\s*=\s*["\']?([^"\'>\s]+)["\']?)?[^>]*>(.*?)</ref>'

        for match in re.finditer(ref_pattern, wikitext, re.DOTALL | re.IGNORECASE):
            ref_name = match.group(1)
            ref_content = match.group(2).strip()

            # Generate ID
            if ref_name:
                ref_id = f"ref_{self._sanitize_id(ref_name)}"
            else:
                ref_id = f"ref_{len(citations) + 1}"

            # Skip if already processed (named refs can appear multiple times)
            if ref_id in citations:
                continue

            # Parse citation template
            citation = self._parse_citation_template(ref_content, ref_id)
            citations[ref_id] = citation

        # Also find named ref usage (refs that just reference existing)
        # Pattern: <ref name="xxx" /> or <ref name="xxx"/>
        named_ref_pattern = r'<ref\s+name\s*=\s*["\']?([^"\'>/\s]+)["\']?\s*/>'

        return citations

    def _parse_citation_template(self, content: str, ref_id: str) -> Citation:
        """
        Parse a citation template into structured data.

        Args:
            content: Citation template content
            ref_id: Reference ID

        Returns:
            Citation object
        """
        # Detect template type
        template_type = 'article'  # default
        for template in self.CITE_TEMPLATES:
            if template.lower() in content.lower():
                template_type = self.TYPE_MAP.get(template, 'article')
                break

        # Extract template parameters
        params = self._extract_template_params(content)

        # Parse author(s)
        authors = self._parse_authors(params)

        # Parse date
        issued = self._parse_date(params.get('date') or params.get('year'))
        accessed = self._parse_date(params.get('access-date') or params.get('accessdate'))

        return Citation(
            id=ref_id,
            type=template_type,
            title=params.get('title'),
            author=authors if authors else None,
            URL=params.get('url'),
            DOI=params.get('doi'),
            ISBN=params.get('isbn'),
            PMID=params.get('pmid'),
            issued=issued,
            accessed=accessed,
            publisher=params.get('publisher'),
            container_title=params.get('journal') or params.get('work') or params.get('website'),
            volume=params.get('volume'),
            issue=params.get('issue'),
            page=params.get('pages') or params.get('page'),
            quote=params.get('quote'),
            language=params.get('language'),
            archive_url=params.get('archive-url') or params.get('archiveurl'),
            raw_citation=content
        )

    def _extract_template_params(self, content: str) -> Dict[str, str]:
        """
        Extract parameters from a wiki template.

        Args:
            content: Template content

        Returns:
            Dictionary of parameter name -> value
        """
        params = {}

        # Pattern to match |param=value
        param_pattern = r'\|\s*([a-zA-Z0-9_-]+)\s*=\s*([^|{}]*?)(?=\||}}|$)'

        for match in re.finditer(param_pattern, content, re.DOTALL):
            key = match.group(1).strip().lower()
            value = match.group(2).strip()
            # Clean up wiki markup
            value = re.sub(r'\[\[([^\]|]+)\|?([^\]]*)\]\]', r'\2' if r'\2' else r'\1', value)
            value = re.sub(r"'''?", '', value)  # Remove bold/italic
            if value:
                params[key] = value

        return params

    def _parse_authors(self, params: Dict[str, str]) -> List[Dict[str, str]]:
        """Parse author information from template params."""
        authors = []

        # Check for 'author' or 'authors' field
        if 'author' in params:
            author_str = params['author']
            # Try to split "Last, First" format
            if ',' in author_str:
                parts = author_str.split(',', 1)
                authors.append({
                    'family': parts[0].strip(),
                    'given': parts[1].strip() if len(parts) > 1 else ''
                })
            else:
                authors.append({'family': author_str, 'given': ''})

        # Check for numbered authors (last1, first1, last2, first2, etc.)
        for i in range(1, 10):
            last_key = f'last{i}' if i > 1 else 'last'
            first_key = f'first{i}' if i > 1 else 'first'

            if last_key in params or f'last{i}' in params:
                last = params.get(last_key) or params.get(f'last{i}', '')
                first = params.get(first_key) or params.get(f'first{i}', '')
                if last:
                    authors.append({'family': last, 'given': first})

        return authors

    def _parse_date(self, date_str: Optional[str]) -> Optional[Dict]:
        """
        Parse date string into CSL date format.

        Args:
            date_str: Date string in various formats

        Returns:
            CSL date object or None
        """
        if not date_str:
            return None

        # Try different date formats
        formats = [
            ('%Y-%m-%d', 3),  # 2024-01-15
            ('%B %d, %Y', 3),  # January 15, 2024
            ('%d %B %Y', 3),  # 15 January 2024
            ('%Y-%m', 2),  # 2024-01
            ('%B %Y', 2),  # January 2024
            ('%Y', 1),  # 2024
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

        # If we can extract just a year
        year_match = re.search(r'\b(19|20)\d{2}\b', date_str)
        if year_match:
            return {'date-parts': [[int(year_match.group())]]}

        return None

    def _parse_sections(
        self,
        html: str,
        section_info: List[Dict],
        citations: Dict[str, Citation]
    ) -> List[Section]:
        """
        Parse article sections and map content to citations.

        Args:
            html: Article HTML
            section_info: Section metadata from API
            citations: Extracted citations

        Returns:
            List of Section objects
        """
        sections = []

        # Add lead section
        lead_content = self._extract_lead_section(html)
        lead_claims = self._extract_claims(lead_content, citations)
        sections.append(Section(
            heading="Introduction",
            level=1,
            content=self._clean_html(lead_content),
            claims=lead_claims
        ))

        # Process each section
        for sec in section_info:
            section_html = self._extract_section_html(html, sec.get('anchor', ''))
            section_claims = self._extract_claims(section_html, citations)

            sections.append(Section(
                heading=sec.get('line', 'Unknown'),
                level=int(sec.get('level', 2)),
                content=self._clean_html(section_html),
                claims=section_claims
            ))

        return sections

    def _extract_lead_section(self, html: str) -> str:
        """Extract content before first heading."""
        # Find first h2 or h3
        match = re.search(r'<h[23][^>]*>', html)
        if match:
            return html[:match.start()]
        return html[:5000]  # Limit if no heading found

    def _extract_section_html(self, html: str, anchor: str) -> str:
        """Extract HTML for a specific section."""
        if not anchor:
            return ""

        # Find section start
        pattern = rf'<span[^>]*id="{re.escape(anchor)}"[^>]*>.*?</span>'
        match = re.search(pattern, html, re.IGNORECASE)

        if not match:
            return ""

        start = match.end()

        # Find next heading of same or higher level
        next_heading = re.search(r'<h[23][^>]*>', html[start:])
        if next_heading:
            end = start + next_heading.start()
        else:
            end = len(html)

        return html[start:end]

    def _extract_claims(
        self,
        content: str,
        citations: Dict[str, Citation]
    ) -> List[Claim]:
        """
        Extract factual claims and map to citations.

        Args:
            content: HTML content
            citations: Available citations

        Returns:
            List of Claim objects
        """
        claims = []

        # Pattern to find sentences with citation markers
        # Look for text followed by citation reference
        citation_pattern = r'([^.!?]*?)\s*<sup[^>]*class="reference"[^>]*>.*?</sup>'

        for match in re.finditer(citation_pattern, content):
            claim_text = self._clean_html(match.group(1)).strip()

            if len(claim_text) < 10:  # Skip very short fragments
                continue

            # Find citation IDs referenced
            ref_links = re.findall(r'#cite_note-([^"]+)', match.group(0))

            citation_ids = []
            for ref_link in ref_links:
                # Try to match to our extracted citations
                possible_id = f"ref_{self._sanitize_id(ref_link)}"
                if possible_id in citations:
                    citation_ids.append(possible_id)
                else:
                    # Fallback: create generic ID
                    citation_ids.append(f"ref_{ref_link}")

            if claim_text and citation_ids:
                # Calculate confidence based on citation quality
                confidence = self._calculate_confidence(citation_ids, citations)

                claims.append(Claim(
                    text=claim_text,
                    citation_ids=citation_ids,
                    section="",  # Will be set by caller
                    confidence=confidence
                ))

        return claims

    def _calculate_confidence(
        self,
        citation_ids: List[str],
        citations: Dict[str, Citation]
    ) -> float:
        """
        Calculate confidence score based on citation quality.

        Args:
            citation_ids: IDs of supporting citations
            citations: All citations

        Returns:
            Confidence score 0-1
        """
        if not citation_ids:
            return 0.0

        scores = []
        for cid in citation_ids:
            citation = citations.get(cid)
            if not citation:
                scores.append(0.3)
                continue

            score = 0.5  # Base score

            # Boost for DOI (peer-reviewed)
            if citation.DOI:
                score += 0.2

            # Boost for PMID (medical/scientific)
            if citation.PMID:
                score += 0.15

            # Boost for ISBN (book)
            if citation.ISBN:
                score += 0.1

            # Boost for URL (verifiable)
            if citation.URL:
                score += 0.05

            # Boost for author information
            if citation.author:
                score += 0.1

            # Boost for publication info
            if citation.container_title:
                score += 0.05

            scores.append(min(score, 1.0))

        return sum(scores) / len(scores)

    def _clean_html(self, html: str) -> str:
        """Remove HTML tags and clean text."""
        # Remove tags
        text = re.sub(r'<[^>]+>', '', html)
        # Decode entities
        text = text.replace('&nbsp;', ' ')
        text = text.replace('&amp;', '&')
        text = text.replace('&lt;', '<')
        text = text.replace('&gt;', '>')
        text = text.replace('&quot;', '"')
        # Clean whitespace
        text = re.sub(r'\s+', ' ', text)
        return text.strip()

    def _sanitize_id(self, text: str) -> str:
        """Sanitize string for use as ID."""
        return re.sub(r'[^a-zA-Z0-9_-]', '_', text)[:50]

    def _section_to_dict(self, section: Section) -> Dict:
        """Convert Section to dictionary."""
        return {
            'heading': section.heading,
            'level': section.level,
            'content': section.content,
            'claims': [
                {
                    'text': c.text,
                    'citation_ids': c.citation_ids,
                    'confidence': round(c.confidence, 2)
                }
                for c in section.claims
            ]
        }

    def _citation_to_csl(self, citation: Citation) -> Dict:
        """Convert Citation to CSL-JSON format."""
        result = {
            'id': citation.id,
            'type': citation.type
        }

        if citation.title:
            result['title'] = citation.title
        if citation.author:
            result['author'] = citation.author
        if citation.URL:
            result['URL'] = citation.URL
        if citation.DOI:
            result['DOI'] = citation.DOI
        if citation.ISBN:
            result['ISBN'] = citation.ISBN
        if citation.PMID:
            result['PMID'] = citation.PMID
        if citation.issued:
            result['issued'] = citation.issued
        if citation.accessed:
            result['accessed'] = citation.accessed
        if citation.publisher:
            result['publisher'] = citation.publisher
        if citation.container_title:
            result['container-title'] = citation.container_title
        if citation.volume:
            result['volume'] = citation.volume
        if citation.issue:
            result['issue'] = citation.issue
        if citation.page:
            result['page'] = citation.page
        if citation.quote:
            result['quote'] = citation.quote
        if citation.archive_url:
            result['archive-URL'] = citation.archive_url

        return result


if __name__ == "__main__":
    # Example usage
    extractor = CitationExtractor()

    print("Extracting citations from 'Machine learning' article...")
    research = extractor.extract_article("Machine_learning")

    print(f"\nArticle: {research['article']['title']}")
    print(f"Total citations: {research['metadata']['total_citations']}")
    print(f"Total sections: {research['metadata']['total_sections']}")

    print("\nFirst 3 citations:")
    for citation in research['citations'][:3]:
        print(f"  - {citation.get('title', 'No title')} ({citation['type']})")
        if citation.get('URL'):
            print(f"    URL: {citation['URL']}")
        if citation.get('DOI'):
            print(f"    DOI: {citation['DOI']}")
