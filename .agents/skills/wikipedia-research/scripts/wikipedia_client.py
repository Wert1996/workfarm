#!/usr/bin/env python3
"""
Wikipedia API Client
Core client for interacting with Wikipedia's MediaWiki API.
Includes rate limiting, caching, and proper User-Agent handling.
"""

import requests
import time
import json
import hashlib
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Any
from pathlib import Path


class WikipediaClient:
    """Client for Wikipedia's MediaWiki Action API."""

    # API endpoints by language
    API_TEMPLATE = "https://{lang}.wikipedia.org/w/api.php"

    # Required by Wikipedia's API policy
    USER_AGENT = "WikipediaResearchSkill/1.0 (https://github.com/example/wiki-research; research@example.com)"

    def __init__(
        self,
        language: str = "en",
        cache_dir: Optional[str] = None,
        cache_ttl: int = 3600,
        rate_limit: float = 1.0
    ):
        """
        Initialize Wikipedia client.

        Args:
            language: Wikipedia language code (en, de, fr, etc.)
            cache_dir: Directory for caching responses (None to disable)
            cache_ttl: Cache time-to-live in seconds
            rate_limit: Minimum seconds between requests
        """
        self.language = language
        self.api_url = self.API_TEMPLATE.format(lang=language)
        self.cache_dir = Path(cache_dir) if cache_dir else None
        self.cache_ttl = cache_ttl
        self.rate_limit = rate_limit
        self._last_request = 0

        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": self.USER_AGENT
        })

        if self.cache_dir:
            self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _rate_limit_wait(self):
        """Enforce rate limiting between requests."""
        elapsed = time.time() - self._last_request
        if elapsed < self.rate_limit:
            time.sleep(self.rate_limit - elapsed)
        self._last_request = time.time()

    def _cache_key(self, params: Dict) -> str:
        """Generate cache key from request parameters."""
        param_str = json.dumps(params, sort_keys=True)
        return hashlib.md5(param_str.encode()).hexdigest()

    def _get_cached(self, cache_key: str) -> Optional[Dict]:
        """Retrieve cached response if valid."""
        if not self.cache_dir:
            return None

        cache_file = self.cache_dir / f"{cache_key}.json"
        if not cache_file.exists():
            return None

        try:
            with open(cache_file, 'r') as f:
                cached = json.load(f)

            cached_time = datetime.fromisoformat(cached['_cached_at'])
            if datetime.now() - cached_time > timedelta(seconds=self.cache_ttl):
                return None

            return cached['data']
        except (json.JSONDecodeError, KeyError):
            return None

    def _save_cache(self, cache_key: str, data: Dict):
        """Save response to cache."""
        if not self.cache_dir:
            return

        cache_file = self.cache_dir / f"{cache_key}.json"
        with open(cache_file, 'w') as f:
            json.dump({
                '_cached_at': datetime.now().isoformat(),
                'data': data
            }, f)

    def _request(self, params: Dict, use_cache: bool = True) -> Dict:
        """
        Make API request with rate limiting and caching.

        Args:
            params: API parameters
            use_cache: Whether to use cache

        Returns:
            API response as dictionary
        """
        params['format'] = 'json'

        if use_cache:
            cache_key = self._cache_key(params)
            cached = self._get_cached(cache_key)
            if cached:
                return cached

        self._rate_limit_wait()

        response = self.session.get(self.api_url, params=params)
        response.raise_for_status()
        data = response.json()

        if use_cache:
            self._save_cache(cache_key, data)

        return data

    def search(
        self,
        query: str,
        limit: int = 10,
        namespace: int = 0
    ) -> List[Dict]:
        """
        Search for Wikipedia articles.

        Args:
            query: Search query
            limit: Maximum results (max 500)
            namespace: Namespace to search (0 = articles)

        Returns:
            List of search results with title, snippet, pageid
        """
        params = {
            'action': 'query',
            'list': 'search',
            'srsearch': query,
            'srlimit': min(limit, 500),
            'srnamespace': namespace,
            'srprop': 'snippet|titlesnippet|size|wordcount|timestamp'
        }

        response = self._request(params)
        return response.get('query', {}).get('search', [])

    def get_article(
        self,
        title: str,
        include_wikitext: bool = False,
        sections: bool = True
    ) -> Dict:
        """
        Get article content and metadata.

        Args:
            title: Article title (use underscores for spaces)
            include_wikitext: Include raw wikitext for parsing
            sections: Include section breakdown

        Returns:
            Article data with content, metadata, sections
        """
        props = ['text', 'categories', 'links', 'externallinks', 'sections', 'revid']
        if include_wikitext:
            props.append('wikitext')

        params = {
            'action': 'parse',
            'page': title,
            'prop': '|'.join(props),
            'disableeditsection': 'true'
        }

        response = self._request(params)

        if 'error' in response:
            raise ValueError(f"Article not found: {title}")

        parse_data = response.get('parse', {})

        return {
            'title': parse_data.get('title', title),
            'pageid': parse_data.get('pageid'),
            'revid': parse_data.get('revid'),
            'html': parse_data.get('text', {}).get('*', ''),
            'wikitext': parse_data.get('wikitext', {}).get('*', '') if include_wikitext else None,
            'categories': [c['*'] for c in parse_data.get('categories', [])],
            'sections': parse_data.get('sections', []),
            'links': [l['*'] for l in parse_data.get('links', []) if l.get('ns') == 0],
            'external_links': parse_data.get('externallinks', []),
            'url': f"https://{self.language}.wikipedia.org/wiki/{title}",
            'extracted_at': datetime.now().isoformat()
        }

    def get_article_text(self, title: str) -> str:
        """
        Get plain text extract of article.

        Args:
            title: Article title

        Returns:
            Plain text content
        """
        params = {
            'action': 'query',
            'titles': title,
            'prop': 'extracts',
            'explaintext': 'true',
            'exsectionformat': 'plain'
        }

        response = self._request(params)
        pages = response.get('query', {}).get('pages', {})

        for page in pages.values():
            return page.get('extract', '')

        return ''

    def get_categories(self, title: str) -> List[str]:
        """Get all categories for an article."""
        params = {
            'action': 'query',
            'titles': title,
            'prop': 'categories',
            'cllimit': 500
        }

        response = self._request(params)
        pages = response.get('query', {}).get('pages', {})

        categories = []
        for page in pages.values():
            for cat in page.get('categories', []):
                # Remove "Category:" prefix
                cat_name = cat.get('title', '').replace('Category:', '')
                categories.append(cat_name)

        return categories

    def get_links(self, title: str, namespace: int = 0) -> List[str]:
        """Get all links from an article."""
        params = {
            'action': 'query',
            'titles': title,
            'prop': 'links',
            'plnamespace': namespace,
            'pllimit': 500
        }

        response = self._request(params)
        pages = response.get('query', {}).get('pages', {})

        links = []
        for page in pages.values():
            for link in page.get('links', []):
                links.append(link.get('title', ''))

        return links

    def get_backlinks(self, title: str, limit: int = 100) -> List[str]:
        """Get articles that link to this article."""
        params = {
            'action': 'query',
            'list': 'backlinks',
            'bltitle': title,
            'bllimit': min(limit, 500),
            'blnamespace': 0
        }

        response = self._request(params)
        backlinks = response.get('query', {}).get('backlinks', [])

        return [bl.get('title', '') for bl in backlinks]

    def get_revision_info(self, title: str) -> Dict:
        """Get revision metadata for an article."""
        params = {
            'action': 'query',
            'titles': title,
            'prop': 'revisions',
            'rvprop': 'ids|timestamp|user|comment|size'
        }

        response = self._request(params)
        pages = response.get('query', {}).get('pages', {})

        for page in pages.values():
            revisions = page.get('revisions', [{}])
            if revisions:
                return revisions[0]

        return {}


class WikidataClient:
    """Client for Wikidata SPARQL queries."""

    SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
    USER_AGENT = "WikipediaResearchSkill/1.0 (https://github.com/example/wiki-research; research@example.com)"

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": self.USER_AGENT,
            "Accept": "application/sparql-results+json"
        })

    def query(self, sparql: str) -> List[Dict]:
        """
        Execute SPARQL query against Wikidata.

        Args:
            sparql: SPARQL query string

        Returns:
            List of result bindings
        """
        response = self.session.get(
            self.SPARQL_ENDPOINT,
            params={'query': sparql, 'format': 'json'}
        )
        response.raise_for_status()

        data = response.json()
        return data.get('results', {}).get('bindings', [])

    def get_entity(self, entity_id: str) -> Dict:
        """
        Get Wikidata entity by Q-ID.

        Args:
            entity_id: Wikidata entity ID (e.g., "Q42")

        Returns:
            Entity data with labels, descriptions, claims
        """
        url = f"https://www.wikidata.org/wiki/Special:EntityData/{entity_id}.json"

        response = self.session.get(url)
        response.raise_for_status()

        data = response.json()
        entity = data.get('entities', {}).get(entity_id, {})

        return {
            'id': entity_id,
            'labels': {
                lang: val.get('value')
                for lang, val in entity.get('labels', {}).items()
            },
            'descriptions': {
                lang: val.get('value')
                for lang, val in entity.get('descriptions', {}).items()
            },
            'aliases': {
                lang: [a.get('value') for a in aliases]
                for lang, aliases in entity.get('aliases', {}).items()
            },
            'claims': entity.get('claims', {})
        }

    def get_wikipedia_qid(self, title: str, language: str = "en") -> Optional[str]:
        """
        Get Wikidata Q-ID for a Wikipedia article.

        Args:
            title: Wikipedia article title
            language: Wikipedia language code

        Returns:
            Wikidata Q-ID or None
        """
        sparql = f"""
        SELECT ?item WHERE {{
          ?article schema:about ?item ;
                   schema:isPartOf <https://{language}.wikipedia.org/> ;
                   schema:name "{title}"@{language} .
        }}
        LIMIT 1
        """

        results = self.query(sparql)
        if results:
            uri = results[0].get('item', {}).get('value', '')
            return uri.split('/')[-1] if uri else None

        return None


if __name__ == "__main__":
    # Example usage
    client = WikipediaClient()

    # Search
    results = client.search("artificial intelligence", limit=5)
    print("Search results:")
    for r in results:
        print(f"  - {r['title']}")

    # Get article
    article = client.get_article("Artificial_intelligence", include_wikitext=True)
    print(f"\nArticle: {article['title']}")
    print(f"Revision: {article['revid']}")
    print(f"Categories: {len(article['categories'])}")
    print(f"Links: {len(article['links'])}")
