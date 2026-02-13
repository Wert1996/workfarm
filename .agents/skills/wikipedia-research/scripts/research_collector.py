#!/usr/bin/env python3
"""
Wikipedia Research Collector
Orchestrates multi-article research collection with citation aggregation.
Outputs structured research data optimized for AI verification.
"""

import json
from datetime import datetime
from typing import Dict, List, Optional, Set, Any
from pathlib import Path
from collections import defaultdict

# Import local modules
try:
    from .wikipedia_client import WikipediaClient
    from .citation_extractor import CitationExtractor
except ImportError:
    from wikipedia_client import WikipediaClient
    from citation_extractor import CitationExtractor


class ResearchCollector:
    """Collect and organize research across multiple Wikipedia articles."""

    # Source quality ratings (Admiralty Code)
    RELIABILITY_SCORES = {
        'A': 1.0,   # Completely reliable
        'B': 0.8,   # Usually reliable
        'C': 0.6,   # Fairly reliable
        'D': 0.4,   # Not usually reliable
        'E': 0.2,   # Unreliable
        'F': 0.0    # Cannot be judged
    }

    def __init__(self, language: str = "en", cache_dir: Optional[str] = None):
        """
        Initialize research collector.

        Args:
            language: Wikipedia language code
            cache_dir: Directory for caching API responses
        """
        self.client = WikipediaClient(language=language, cache_dir=cache_dir)
        self.extractor = CitationExtractor(language=language)
        self.language = language

    def research_topic(
        self,
        query: str,
        max_articles: int = 5,
        depth: str = "comprehensive",
        follow_links: bool = False
    ) -> Dict[str, Any]:
        """
        Research a topic across multiple Wikipedia articles.

        Args:
            query: Search query or topic
            max_articles: Maximum articles to process
            depth: "summary" for quick overview, "comprehensive" for full extraction
            follow_links: Whether to follow internal links for related articles

        Returns:
            Comprehensive research data with aggregated citations
        """
        # Search for relevant articles
        search_results = self.client.search(query, limit=max_articles * 2)

        # Process top articles
        articles_data = []
        all_citations = {}
        citation_usage = defaultdict(list)  # Track which articles use each citation

        processed_titles = set()

        for result in search_results[:max_articles]:
            title = result['title'].replace(' ', '_')

            if title in processed_titles:
                continue
            processed_titles.add(title)

            try:
                if depth == "comprehensive":
                    article_data = self.extractor.extract_article(title)
                else:
                    article_data = self._extract_summary(title)

                articles_data.append(article_data)

                # Aggregate citations
                for citation in article_data.get('citations', []):
                    cit_id = citation['id']
                    if cit_id not in all_citations:
                        all_citations[cit_id] = citation
                    citation_usage[cit_id].append(article_data['article']['title'])

            except Exception as e:
                print(f"Error processing {title}: {e}")
                continue

        # Follow internal links if requested
        if follow_links and len(articles_data) < max_articles:
            additional = self._follow_links(
                articles_data,
                processed_titles,
                max_articles - len(articles_data)
            )
            articles_data.extend(additional)

        # Build research output
        return self._build_research_output(
            query=query,
            articles=articles_data,
            citations=all_citations,
            citation_usage=citation_usage
        )

    def research_articles(
        self,
        titles: List[str],
        depth: str = "comprehensive"
    ) -> Dict[str, Any]:
        """
        Research specific Wikipedia articles.

        Args:
            titles: List of article titles to research
            depth: "summary" or "comprehensive"

        Returns:
            Research data for specified articles
        """
        articles_data = []
        all_citations = {}
        citation_usage = defaultdict(list)

        for title in titles:
            title = title.replace(' ', '_')

            try:
                if depth == "comprehensive":
                    article_data = self.extractor.extract_article(title)
                else:
                    article_data = self._extract_summary(title)

                articles_data.append(article_data)

                for citation in article_data.get('citations', []):
                    cit_id = citation['id']
                    if cit_id not in all_citations:
                        all_citations[cit_id] = citation
                    citation_usage[cit_id].append(article_data['article']['title'])

            except Exception as e:
                print(f"Error processing {title}: {e}")
                continue

        return self._build_research_output(
            query=f"Articles: {', '.join(titles)}",
            articles=articles_data,
            citations=all_citations,
            citation_usage=citation_usage
        )

    def find_related_by_citations(
        self,
        title: str,
        min_shared_citations: int = 2
    ) -> List[Dict]:
        """
        Find articles that share citations with the given article.

        Args:
            title: Source article title
            min_shared_citations: Minimum shared citations to be considered related

        Returns:
            List of related articles with shared citation info
        """
        # Get source article citations
        source_data = self.extractor.extract_article(title)
        source_citations = {
            c.get('URL') or c.get('DOI') or c.get('title'): c
            for c in source_data.get('citations', [])
            if c.get('URL') or c.get('DOI') or c.get('title')
        }

        # Get linked articles
        linked_titles = self.client.get_links(title)[:50]

        related_articles = []

        for linked_title in linked_titles:
            try:
                linked_data = self.extractor.extract_citations(linked_title)

                # Find shared citations
                shared = []
                for citation in linked_data:
                    key = citation.get('URL') or citation.get('DOI') or citation.get('title')
                    if key and key in source_citations:
                        shared.append(citation)

                if len(shared) >= min_shared_citations:
                    related_articles.append({
                        'title': linked_title,
                        'shared_citations': len(shared),
                        'shared_citation_ids': [c['id'] for c in shared]
                    })

            except Exception:
                continue

        # Sort by number of shared citations
        related_articles.sort(key=lambda x: x['shared_citations'], reverse=True)

        return related_articles

    def verify_claim(
        self,
        claim: str,
        articles: List[str]
    ) -> Dict[str, Any]:
        """
        Attempt to verify a claim across multiple Wikipedia articles.

        Args:
            claim: The claim to verify
            articles: Articles to search for supporting evidence

        Returns:
            Verification results with supporting/contradicting evidence
        """
        supporting_evidence = []
        related_content = []

        claim_words = set(claim.lower().split())

        for title in articles:
            try:
                article_data = self.extractor.extract_article(title)

                for section in article_data.get('sections', []):
                    for article_claim in section.get('claims', []):
                        claim_text = article_claim.get('text', '').lower()
                        claim_text_words = set(claim_text.split())

                        # Simple overlap check (could be enhanced with NLP)
                        overlap = len(claim_words & claim_text_words) / len(claim_words)

                        if overlap > 0.3:  # Threshold for relevance
                            evidence = {
                                'article': title,
                                'section': section.get('heading'),
                                'text': article_claim.get('text'),
                                'citation_ids': article_claim.get('citation_ids', []),
                                'confidence': article_claim.get('confidence', 0),
                                'relevance': round(overlap, 2)
                            }

                            # Get full citation details
                            evidence['citations'] = [
                                c for c in article_data.get('citations', [])
                                if c['id'] in article_claim.get('citation_ids', [])
                            ]

                            if overlap > 0.5:
                                supporting_evidence.append(evidence)
                            else:
                                related_content.append(evidence)

            except Exception as e:
                print(f"Error checking {title}: {e}")
                continue

        # Calculate overall verification score
        verification_score = 0.0
        if supporting_evidence:
            avg_confidence = sum(e['confidence'] for e in supporting_evidence) / len(supporting_evidence)
            avg_relevance = sum(e['relevance'] for e in supporting_evidence) / len(supporting_evidence)
            verification_score = (avg_confidence * 0.6 + avg_relevance * 0.4)

        return {
            'claim': claim,
            'verification_score': round(verification_score, 2),
            'status': self._get_verification_status(verification_score),
            'supporting_evidence': supporting_evidence,
            'related_content': related_content,
            'articles_checked': articles,
            'verified_at': datetime.now().isoformat()
        }

    def save_research(
        self,
        research: Dict,
        filepath: str,
        format: str = "json"
    ):
        """
        Save research data to file.

        Args:
            research: Research data to save
            filepath: Output file path
            format: Output format ("json" or "jsonl")
        """
        path = Path(filepath)
        path.parent.mkdir(parents=True, exist_ok=True)

        if format == "json":
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(research, f, indent=2, ensure_ascii=False)
        elif format == "jsonl":
            with open(path, 'w', encoding='utf-8') as f:
                # Write articles as separate lines
                for article in research.get('articles', []):
                    f.write(json.dumps(article, ensure_ascii=False) + '\n')
        else:
            raise ValueError(f"Unsupported format: {format}")

        print(f"Research saved to: {path}")

    def load_research(self, filepath: str) -> Dict:
        """Load previously saved research data."""
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)

    def _extract_summary(self, title: str) -> Dict:
        """Extract summary-level data for an article."""
        article = self.client.get_article(title, include_wikitext=False)

        return {
            'article': {
                'title': article['title'],
                'url': article['url'],
                'revision_id': str(article.get('revid', '')),
                'extracted_at': article.get('extracted_at'),
                'categories': article.get('categories', [])[:10]
            },
            'sections': [
                {'heading': s.get('line', ''), 'level': int(s.get('level', 2))}
                for s in article.get('sections', [])[:20]
            ],
            'citations': [],  # Skip detailed citation extraction for summary
            'metadata': {
                'depth': 'summary',
                'links_count': len(article.get('links', []))
            }
        }

    def _follow_links(
        self,
        articles: List[Dict],
        processed: Set[str],
        max_additional: int
    ) -> List[Dict]:
        """Follow internal links to find related articles."""
        additional_articles = []

        # Collect all links from processed articles
        all_links = set()
        for article in articles:
            title = article['article']['title'].replace(' ', '_')
            links = self.client.get_links(title)
            all_links.update(links[:20])

        # Remove already processed
        new_links = [l for l in all_links if l.replace(' ', '_') not in processed]

        # Process additional articles
        for link in new_links[:max_additional]:
            link_title = link.replace(' ', '_')
            if link_title in processed:
                continue

            try:
                article_data = self._extract_summary(link_title)
                additional_articles.append(article_data)
                processed.add(link_title)
            except Exception:
                continue

        return additional_articles

    def _build_research_output(
        self,
        query: str,
        articles: List[Dict],
        citations: Dict,
        citation_usage: Dict
    ) -> Dict:
        """Build the final research output structure."""
        # Calculate aggregate statistics
        total_claims = sum(
            len(section.get('claims', []))
            for article in articles
            for section in article.get('sections', [])
        )

        # Identify high-value citations (used in multiple articles)
        cross_referenced = [
            {
                'citation': citations[cid],
                'used_in': titles,
                'usage_count': len(titles)
            }
            for cid, titles in citation_usage.items()
            if len(titles) > 1
        ]
        cross_referenced.sort(key=lambda x: x['usage_count'], reverse=True)

        # Assess overall source quality
        quality_assessment = self._assess_source_quality(list(citations.values()))

        return {
            'research_query': query,
            'research_date': datetime.now().isoformat(),
            'summary': {
                'articles_analyzed': len(articles),
                'total_citations': len(citations),
                'total_claims_extracted': total_claims,
                'cross_referenced_citations': len(cross_referenced),
                'source_quality': quality_assessment
            },
            'articles': articles,
            'all_citations': list(citations.values()),
            'cross_referenced_citations': cross_referenced[:20],
            'provenance': {
                'tool': 'Wikipedia Research Skill',
                'version': '1.0',
                'language': self.language,
                'extraction_method': 'MediaWiki API + wikitext parsing',
                'generated_at': datetime.now().isoformat()
            }
        }

    def _assess_source_quality(self, citations: List[Dict]) -> Dict:
        """Assess overall quality of sources."""
        if not citations:
            return {'rating': 'F', 'score': 0, 'breakdown': {}}

        quality_indicators = {
            'has_doi': 0,
            'has_url': 0,
            'has_author': 0,
            'has_date': 0,
            'peer_reviewed': 0,  # Approximated by DOI/PMID
            'accessible': 0  # Has URL
        }

        for citation in citations:
            if citation.get('DOI'):
                quality_indicators['has_doi'] += 1
                quality_indicators['peer_reviewed'] += 1
            if citation.get('PMID'):
                quality_indicators['peer_reviewed'] += 1
            if citation.get('URL'):
                quality_indicators['has_url'] += 1
                quality_indicators['accessible'] += 1
            if citation.get('author'):
                quality_indicators['has_author'] += 1
            if citation.get('issued'):
                quality_indicators['has_date'] += 1

        total = len(citations)
        percentages = {k: round(v / total * 100, 1) for k, v in quality_indicators.items()}

        # Calculate overall score
        score = (
            percentages['has_doi'] * 0.25 +
            percentages['has_author'] * 0.20 +
            percentages['has_date'] * 0.15 +
            percentages['has_url'] * 0.20 +
            percentages['peer_reviewed'] * 0.20
        ) / 100

        # Map to Admiralty rating
        if score >= 0.8:
            rating = 'A'
        elif score >= 0.6:
            rating = 'B'
        elif score >= 0.4:
            rating = 'C'
        elif score >= 0.2:
            rating = 'D'
        else:
            rating = 'E'

        return {
            'rating': rating,
            'score': round(score, 2),
            'breakdown': percentages
        }

    def _get_verification_status(self, score: float) -> str:
        """Get verification status from score."""
        if score >= 0.8:
            return 'strongly_supported'
        elif score >= 0.6:
            return 'supported'
        elif score >= 0.4:
            return 'partially_supported'
        elif score >= 0.2:
            return 'weakly_supported'
        else:
            return 'insufficient_evidence'


if __name__ == "__main__":
    # Example usage
    collector = ResearchCollector()

    print("Researching 'artificial intelligence'...")
    research = collector.research_topic(
        query="artificial intelligence",
        max_articles=3,
        depth="comprehensive"
    )

    print(f"\nResearch Summary:")
    print(f"  Articles analyzed: {research['summary']['articles_analyzed']}")
    print(f"  Total citations: {research['summary']['total_citations']}")
    print(f"  Claims extracted: {research['summary']['total_claims_extracted']}")
    print(f"  Source quality: {research['summary']['source_quality']['rating']}")

    # Save research
    collector.save_research(research, "ai_research.json")
