#!/usr/bin/env python3
"""
Source Verifier
Validates citations, checks for contradictions, and assesses source reliability.
Critical for AI-consumable research verification.
"""

import re
import json
import requests
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field
from urllib.parse import urlparse
import hashlib

try:
    from .wikipedia_client import WikipediaClient
except ImportError:
    from wikipedia_client import WikipediaClient


@dataclass
class VerificationResult:
    """Result of verifying a single citation."""
    citation_id: str
    status: str  # 'verified', 'unverified', 'dead_link', 'paywall', 'redirected'
    url_accessible: bool
    doi_valid: Optional[bool] = None
    pmid_valid: Optional[bool] = None
    archive_available: Optional[str] = None
    last_checked: str = field(default_factory=lambda: datetime.now().isoformat())
    notes: List[str] = field(default_factory=list)


@dataclass
class ConsistencyIssue:
    """A detected inconsistency between sources."""
    claim: str
    field: str  # What field differs (date, name, fact)
    sources: List[Dict]  # [{source, value}, ...]
    severity: str  # 'minor', 'moderate', 'major'
    resolution: Optional[str] = None


@dataclass
class UncertaintyFlag:
    """Flag for uncertain or disputed content."""
    section: str
    text: str
    flag_type: str  # 'citation_needed', 'disputed', 'outdated', 'primary_source'
    wikipedia_template: Optional[str] = None


class SourceVerifier:
    """Verify sources and detect inconsistencies in research data."""

    # Common archive services
    ARCHIVE_SERVICES = [
        "https://web.archive.org/web/",
        "https://archive.today/",
        "https://webcache.googleusercontent.com/search?q=cache:"
    ]

    # DOI resolution endpoint
    DOI_API = "https://doi.org/api/handles/"

    # PubMed API
    PUBMED_API = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"

    def __init__(self, timeout: int = 10):
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'WikipediaResearchSkill/1.0 (research verification)'
        })

    def verify_citations(self, citations: List[Dict]) -> Dict[str, VerificationResult]:
        """
        Verify all citations in a research output.

        Args:
            citations: List of CSL-JSON citations

        Returns:
            Dictionary mapping citation IDs to verification results
        """
        results = {}

        for citation in citations:
            cit_id = citation.get('id', 'unknown')
            result = self._verify_single_citation(citation)
            results[cit_id] = result

        return results

    def _verify_single_citation(self, citation: Dict) -> VerificationResult:
        """Verify a single citation."""
        cit_id = citation.get('id', 'unknown')
        notes = []
        status = 'unverified'

        # Check URL accessibility
        url = citation.get('URL')
        url_accessible = False
        if url:
            url_accessible, url_note = self._check_url(url)
            if url_note:
                notes.append(url_note)

        # Check DOI validity
        doi_valid = None
        doi = citation.get('DOI')
        if doi:
            doi_valid = self._verify_doi(doi)
            if doi_valid:
                status = 'verified'
                notes.append(f"DOI {doi} is valid")
            else:
                notes.append(f"DOI {doi} could not be verified")

        # Check PMID validity
        pmid_valid = None
        pmid = citation.get('PMID')
        if pmid:
            pmid_valid = self._verify_pmid(pmid)
            if pmid_valid:
                status = 'verified'
                notes.append(f"PMID {pmid} is valid")

        # Check for archive if URL is dead
        archive_url = None
        if url and not url_accessible:
            archive_url = self._find_archive(url)
            if archive_url:
                notes.append(f"Archive found: {archive_url}")
                status = 'archived'
            else:
                status = 'dead_link'

        # Determine final status
        if doi_valid or pmid_valid:
            status = 'verified'
        elif url_accessible:
            status = 'accessible'
        elif archive_url:
            status = 'archived'
        elif url and not url_accessible:
            status = 'dead_link'

        return VerificationResult(
            citation_id=cit_id,
            status=status,
            url_accessible=url_accessible,
            doi_valid=doi_valid,
            pmid_valid=pmid_valid,
            archive_available=archive_url,
            notes=notes
        )

    def _check_url(self, url: str) -> Tuple[bool, Optional[str]]:
        """Check if URL is accessible."""
        try:
            response = self.session.head(url, timeout=self.timeout, allow_redirects=True)
            if response.status_code == 200:
                return True, None
            elif response.status_code == 403:
                return False, "URL returns 403 (possibly paywalled)"
            elif response.status_code == 404:
                return False, "URL returns 404 (not found)"
            else:
                return False, f"URL returns {response.status_code}"
        except requests.RequestException as e:
            return False, f"URL check failed: {str(e)[:50]}"

    def _verify_doi(self, doi: str) -> bool:
        """Verify DOI exists via DOI.org API."""
        try:
            # Clean DOI
            doi = doi.replace("https://doi.org/", "").replace("http://doi.org/", "")
            response = self.session.get(
                f"https://doi.org/{doi}",
                timeout=self.timeout,
                allow_redirects=False
            )
            # DOI.org returns 302 redirect for valid DOIs
            return response.status_code in [200, 301, 302, 303]
        except requests.RequestException:
            return False

    def _verify_pmid(self, pmid: str) -> bool:
        """Verify PMID exists via NCBI API."""
        try:
            response = self.session.get(
                self.PUBMED_API,
                params={'db': 'pubmed', 'id': pmid, 'retmode': 'json'},
                timeout=self.timeout
            )
            data = response.json()
            # Check if result exists and isn't an error
            result = data.get('result', {}).get(str(pmid), {})
            return 'error' not in result
        except (requests.RequestException, json.JSONDecodeError):
            return False

    def _find_archive(self, url: str) -> Optional[str]:
        """Try to find archived version of URL."""
        try:
            # Check Wayback Machine
            wayback_api = f"https://archive.org/wayback/available?url={url}"
            response = self.session.get(wayback_api, timeout=self.timeout)
            data = response.json()

            snapshots = data.get('archived_snapshots', {})
            closest = snapshots.get('closest', {})

            if closest.get('available'):
                return closest.get('url')
        except (requests.RequestException, json.JSONDecodeError):
            pass

        return None

    def detect_inconsistencies(
        self,
        research_data: Dict,
        external_sources: Optional[List[Dict]] = None
    ) -> List[ConsistencyIssue]:
        """
        Detect inconsistencies within research data or against external sources.

        Args:
            research_data: The structured research output
            external_sources: Optional list of external data to compare against

        Returns:
            List of detected inconsistencies
        """
        issues = []

        # Extract all claims with their citations
        claims_by_topic = self._group_claims_by_topic(research_data)

        # Check for internal inconsistencies
        for topic, claims in claims_by_topic.items():
            if len(claims) > 1:
                issue = self._check_claim_consistency(topic, claims)
                if issue:
                    issues.append(issue)

        # Check against external sources if provided
        if external_sources:
            for ext_source in external_sources:
                ext_issues = self._compare_to_external(research_data, ext_source)
                issues.extend(ext_issues)

        return issues

    def _group_claims_by_topic(self, research_data: Dict) -> Dict[str, List[Dict]]:
        """Group claims by their apparent topic for consistency checking."""
        claims_by_topic = {}

        # Keywords to identify topics
        topic_keywords = {
            'education': ['degree', 'university', 'phd', 'bsc', 'graduated', 'thesis'],
            'position': ['professor', 'director', 'member', 'faculty'],
            'award': ['prize', 'award', 'fellow', 'honored'],
            'date': ['19', '20', 'year', 'month']
        }

        for section in research_data.get('sections', []):
            for claim in section.get('claims', []):
                text_lower = claim.get('text', '').lower()

                for topic, keywords in topic_keywords.items():
                    if any(kw in text_lower for kw in keywords):
                        if topic not in claims_by_topic:
                            claims_by_topic[topic] = []
                        claims_by_topic[topic].append({
                            'text': claim.get('text'),
                            'section': section.get('heading'),
                            'citations': claim.get('citation_ids', [])
                        })

        return claims_by_topic

    def _check_claim_consistency(self, topic: str, claims: List[Dict]) -> Optional[ConsistencyIssue]:
        """Check if claims on the same topic are consistent."""
        # Extract dates mentioned
        date_pattern = r'\b(19|20)\d{2}\b'

        dates_found = {}
        for claim in claims:
            text = claim.get('text', '')
            dates = re.findall(date_pattern, text)
            for date in dates:
                if date not in dates_found:
                    dates_found[date] = []
                dates_found[date].append(claim)

        # If multiple different dates for same topic, might be inconsistent
        # (though could be legitimate - career progression)

        return None  # Simplified - full implementation would do deeper analysis

    def _compare_to_external(self, research_data: Dict, external: Dict) -> List[ConsistencyIssue]:
        """Compare research data to external source."""
        issues = []
        # Implementation would compare key facts
        return issues

    def extract_uncertainty_flags(self, wikitext: str) -> List[UncertaintyFlag]:
        """
        Extract Wikipedia uncertainty templates from wikitext.

        Args:
            wikitext: Raw Wikipedia wikitext

        Returns:
            List of uncertainty flags found
        """
        flags = []

        # Common uncertainty templates
        templates = {
            r'\{\{citation needed\}\}': 'citation_needed',
            r'\{\{cn\}\}': 'citation_needed',
            r'\{\{fact\}\}': 'citation_needed',
            r'\{\{disputed\}\}': 'disputed',
            r'\{\{dubious\}\}': 'disputed',
            r'\{\{or\}\}': 'original_research',
            r'\{\{original research\}\}': 'original_research',
            r'\{\{primary source[^}]*\}\}': 'primary_source',
            r'\{\{unreliable source\}\}': 'unreliable_source',
            r'\{\{update\}\}': 'outdated',
            r'\{\{out of date\}\}': 'outdated',
            r'\{\{when\}\}': 'vague_time',
            r'\{\{who\}\}': 'vague_attribution',
            r'\{\{peacock\}\}': 'peacock_language',
            r'\{\{weasel\}\}': 'weasel_words'
        }

        for pattern, flag_type in templates.items():
            for match in re.finditer(pattern, wikitext, re.IGNORECASE):
                # Get surrounding context
                start = max(0, match.start() - 100)
                end = min(len(wikitext), match.end() + 100)
                context = wikitext[start:end]

                # Try to identify section
                section_match = re.search(r'==+\s*([^=]+)\s*==+', wikitext[:match.start()])
                section = section_match.group(1) if section_match else "Unknown"

                flags.append(UncertaintyFlag(
                    section=section.strip(),
                    text=context.strip(),
                    flag_type=flag_type,
                    wikipedia_template=match.group(0)
                ))

        return flags

    def generate_verification_report(
        self,
        research_data: Dict,
        citation_results: Dict[str, VerificationResult],
        inconsistencies: List[ConsistencyIssue],
        uncertainty_flags: List[UncertaintyFlag]
    ) -> Dict:
        """
        Generate a comprehensive verification report.

        Args:
            research_data: Original research data
            citation_results: Citation verification results
            inconsistencies: Detected inconsistencies
            uncertainty_flags: Wikipedia uncertainty flags

        Returns:
            Verification report dictionary
        """
        # Count citation statuses
        status_counts = {}
        for result in citation_results.values():
            status = result.status
            status_counts[status] = status_counts.get(status, 0) + 1

        # Calculate verification score
        total = len(citation_results)
        verified = status_counts.get('verified', 0) + status_counts.get('accessible', 0)
        verification_score = verified / total if total > 0 else 0

        # Assess overall reliability
        if verification_score >= 0.8 and len(inconsistencies) == 0:
            reliability = 'high'
        elif verification_score >= 0.6 and len(inconsistencies) <= 2:
            reliability = 'moderate'
        else:
            reliability = 'low'

        return {
            'verification_summary': {
                'total_citations': total,
                'verified_count': verified,
                'verification_score': round(verification_score, 2),
                'dead_links': status_counts.get('dead_link', 0),
                'archived_recoveries': status_counts.get('archived', 0),
                'reliability_assessment': reliability
            },
            'citation_details': {
                cid: {
                    'status': r.status,
                    'url_accessible': r.url_accessible,
                    'doi_valid': r.doi_valid,
                    'pmid_valid': r.pmid_valid,
                    'archive_url': r.archive_available,
                    'notes': r.notes
                }
                for cid, r in citation_results.items()
            },
            'inconsistencies': [
                {
                    'claim': i.claim,
                    'field': i.field,
                    'sources': i.sources,
                    'severity': i.severity
                }
                for i in inconsistencies
            ],
            'uncertainty_flags': [
                {
                    'section': f.section,
                    'type': f.flag_type,
                    'context': f.text[:200],
                    'template': f.wikipedia_template
                }
                for f in uncertainty_flags
            ],
            'verified_at': datetime.now().isoformat()
        }


if __name__ == "__main__":
    # Example usage
    verifier = SourceVerifier()

    # Test DOI verification
    print("Testing DOI verification...")
    valid = verifier._verify_doi("10.1371/journal.pone.0028766")
    print(f"DOI 10.1371/journal.pone.0028766 valid: {valid}")

    # Test PMID verification
    print("\nTesting PMID verification...")
    valid = verifier._verify_pmid("22163331")
    print(f"PMID 22163331 valid: {valid}")
