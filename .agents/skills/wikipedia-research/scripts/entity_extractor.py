#!/usr/bin/env python3
"""
Entity and Relationship Extractor
Extracts entities mentioned in research and maps relationships between them.
Builds timelines and knowledge graphs for comprehensive research.
"""

import re
from datetime import datetime
from typing import Dict, List, Optional, Set, Tuple, Any
from dataclasses import dataclass, field
from collections import defaultdict

try:
    from .wikipedia_client import WikipediaClient
except ImportError:
    from wikipedia_client import WikipediaClient


@dataclass
class Entity:
    """A named entity extracted from research."""
    name: str
    entity_type: str  # person, organization, place, concept, publication
    wikipedia_url: Optional[str] = None
    wikidata_id: Optional[str] = None
    mentions: List[Dict] = field(default_factory=list)  # [{section, context}]
    attributes: Dict[str, Any] = field(default_factory=dict)


@dataclass
class Relationship:
    """A relationship between two entities."""
    source: str  # Entity name
    target: str  # Entity name
    relationship_type: str  # collaborator, employer, institution, publication_venue, etc.
    evidence: List[str] = field(default_factory=list)  # Text supporting this relationship
    confidence: float = 0.0


@dataclass
class TimelineEvent:
    """An event in a timeline."""
    date: str  # ISO date or "YYYY" or "YYYY-MM"
    date_precision: str  # year, month, day
    event_type: str  # education, position, award, publication, etc.
    description: str
    entities_involved: List[str] = field(default_factory=list)
    citation_ids: List[str] = field(default_factory=list)
    confidence: float = 0.0


class EntityExtractor:
    """Extract entities, relationships, and timelines from research data."""

    # Entity type patterns
    PERSON_INDICATORS = [
        r'\b(?:Dr\.?|Prof\.?|Professor)\s+([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)',
        r'\b([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)(?:\s+(?:and|with|,))',
    ]

    ORGANIZATION_PATTERNS = [
        r'((?:University|Institute|College|School|Laboratory|Lab|Center|Centre)\s+(?:of\s+)?[A-Z][A-Za-z\s]+)',
        r'([A-Z][A-Za-z]+\s+(?:University|Institute|College|School|Laboratory|Lab|Center|Centre))',
        r'(Harvard\s+Medical\s+School)',
        r'(Broad\s+Institute)',
        r'(MIT|NIH|NSF|ISCB)',
    ]

    PUBLICATION_PATTERNS = [
        r'(?:published\s+in|journal|appeared\s+in)\s+([A-Z][A-Za-z\s&]+)',
        r'(Nature|Science|Cell|PNAS|PLoS\s+ONE|eLife|Nature\s+Biotechnology)',
    ]

    # Relationship indicators
    COLLABORATION_INDICATORS = [
        'collaborator', 'collaborated', 'with', 'and', 'co-author',
        'together', 'joint', 'partnership'
    ]

    EMPLOYMENT_INDICATORS = [
        'professor at', 'faculty', 'director of', 'member of',
        'works at', 'employed', 'position at', 'joined'
    ]

    EDUCATION_INDICATORS = [
        'degree from', 'graduated from', 'phd at', 'studied at',
        'thesis', 'undergraduate', 'doctoral'
    ]

    def __init__(self, language: str = "en"):
        self.client = WikipediaClient(language=language)
        self.language = language

    def extract_entities(self, research_data: Dict) -> List[Entity]:
        """
        Extract all named entities from research data.

        Args:
            research_data: Structured research output

        Returns:
            List of extracted entities
        """
        entities = {}

        # Process each section
        for section in research_data.get('sections', []):
            content = section.get('content', '')
            section_name = section.get('heading', '')

            # Extract different entity types
            persons = self._extract_persons(content, section_name)
            orgs = self._extract_organizations(content, section_name)
            pubs = self._extract_publications(content, section_name)

            # Merge into entities dict
            for entity in persons + orgs + pubs:
                if entity.name in entities:
                    # Merge mentions
                    entities[entity.name].mentions.extend(entity.mentions)
                else:
                    entities[entity.name] = entity

        # Try to resolve Wikipedia URLs for entities
        for entity in entities.values():
            if entity.entity_type == 'person' and not entity.wikipedia_url:
                entity.wikipedia_url = self._resolve_wikipedia_url(entity.name)

        return list(entities.values())

    def _extract_persons(self, text: str, section: str) -> List[Entity]:
        """Extract person entities from text."""
        persons = []
        seen = set()

        for pattern in self.PERSON_INDICATORS:
            for match in re.finditer(pattern, text):
                name = match.group(1).strip()
                if name not in seen and len(name) > 3:
                    seen.add(name)
                    persons.append(Entity(
                        name=name,
                        entity_type='person',
                        mentions=[{'section': section, 'context': match.group(0)}]
                    ))

        return persons

    def _extract_organizations(self, text: str, section: str) -> List[Entity]:
        """Extract organization entities from text."""
        orgs = []
        seen = set()

        for pattern in self.ORGANIZATION_PATTERNS:
            for match in re.finditer(pattern, text):
                name = match.group(1).strip()
                if name not in seen and len(name) > 3:
                    seen.add(name)
                    orgs.append(Entity(
                        name=name,
                        entity_type='organization',
                        mentions=[{'section': section, 'context': match.group(0)}]
                    ))

        return orgs

    def _extract_publications(self, text: str, section: str) -> List[Entity]:
        """Extract publication venue entities from text."""
        pubs = []
        seen = set()

        for pattern in self.PUBLICATION_PATTERNS:
            for match in re.finditer(pattern, text, re.IGNORECASE):
                name = match.group(1).strip()
                if name not in seen and len(name) > 3:
                    seen.add(name)
                    pubs.append(Entity(
                        name=name,
                        entity_type='publication_venue',
                        mentions=[{'section': section, 'context': match.group(0)}]
                    ))

        return pubs

    def _resolve_wikipedia_url(self, name: str) -> Optional[str]:
        """Try to find Wikipedia URL for an entity."""
        try:
            # Search Wikipedia
            results = self.client.search(name, limit=1)
            if results:
                title = results[0]['title']
                return f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}"
        except Exception:
            pass
        return None

    def extract_relationships(
        self,
        research_data: Dict,
        entities: List[Entity],
        subject_name: str
    ) -> List[Relationship]:
        """
        Extract relationships between entities.

        Args:
            research_data: Structured research output
            entities: Extracted entities
            subject_name: Name of the main subject being researched

        Returns:
            List of relationships
        """
        relationships = []
        entity_names = {e.name for e in entities}

        for section in research_data.get('sections', []):
            content = section.get('content', '')

            # Check for collaborations
            for entity in entities:
                if entity.entity_type == 'person' and entity.name != subject_name:
                    if self._indicates_collaboration(content, entity.name):
                        relationships.append(Relationship(
                            source=subject_name,
                            target=entity.name,
                            relationship_type='collaborator',
                            evidence=[f"Mentioned together in {section.get('heading')}"],
                            confidence=0.7
                        ))

            # Check for employment/affiliation
            for entity in entities:
                if entity.entity_type == 'organization':
                    rel_type = self._detect_affiliation_type(content, entity.name)
                    if rel_type:
                        relationships.append(Relationship(
                            source=subject_name,
                            target=entity.name,
                            relationship_type=rel_type,
                            evidence=[f"Mentioned in {section.get('heading')}"],
                            confidence=0.8
                        ))

        return relationships

    def _indicates_collaboration(self, text: str, person_name: str) -> bool:
        """Check if text indicates collaboration with a person."""
        if person_name not in text:
            return False

        text_lower = text.lower()
        return any(ind in text_lower for ind in self.COLLABORATION_INDICATORS)

    def _detect_affiliation_type(self, text: str, org_name: str) -> Optional[str]:
        """Detect type of affiliation with an organization."""
        if org_name not in text:
            return None

        text_lower = text.lower()

        if any(ind in text_lower for ind in self.EMPLOYMENT_INDICATORS):
            return 'employment'
        if any(ind in text_lower for ind in self.EDUCATION_INDICATORS):
            return 'education'

        return 'affiliation'

    def build_timeline(self, research_data: Dict) -> List[TimelineEvent]:
        """
        Build a timeline of events from research data.

        Args:
            research_data: Structured research output

        Returns:
            Chronologically sorted list of timeline events
        """
        events = []

        # Date patterns
        year_pattern = r'\b(19|20)\d{2}\b'
        month_year_pattern = r'(January|February|March|April|May|June|July|August|September|October|November|December)\s+(19|20)\d{2}'
        full_date_pattern = r'(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(19|20)\d{2}'

        # Event type keywords
        event_keywords = {
            'education': ['degree', 'graduated', 'phd', 'thesis', 'university', 'studied'],
            'position': ['appointed', 'joined', 'became', 'professor', 'director'],
            'award': ['awarded', 'received', 'prize', 'fellow', 'honored'],
            'publication': ['published', 'paper', 'article', 'journal'],
            'founding': ['founded', 'established', 'created', 'started']
        }

        for section in research_data.get('sections', []):
            content = section.get('content', '')
            claims = section.get('claims', [])

            # Split into sentences for better event extraction
            sentences = re.split(r'[.!?]+', content)

            for sentence in sentences:
                # Find dates in sentence
                years = re.findall(year_pattern, sentence)

                if years:
                    # Determine event type
                    event_type = 'general'
                    sentence_lower = sentence.lower()

                    for etype, keywords in event_keywords.items():
                        if any(kw in sentence_lower for kw in keywords):
                            event_type = etype
                            break

                    # Find matching claim for citations
                    matching_citations = []
                    for claim in claims:
                        if any(word in claim.get('text', '').lower()
                               for word in sentence.lower().split()[:5]):
                            matching_citations = claim.get('citation_ids', [])
                            break

                    # Create event for each year mentioned (usually just one)
                    for year in set(years):
                        full_year = year if len(year) == 4 else f"20{year}" if int(year) < 50 else f"19{year}"

                        events.append(TimelineEvent(
                            date=full_year,
                            date_precision='year',
                            event_type=event_type,
                            description=sentence.strip(),
                            citation_ids=matching_citations,
                            confidence=0.7 if matching_citations else 0.5
                        ))

        # Sort by date
        events.sort(key=lambda e: e.date)

        # Remove duplicates (same year + similar description)
        unique_events = []
        seen = set()
        for event in events:
            key = (event.date, event.event_type, event.description[:50])
            if key not in seen:
                seen.add(key)
                unique_events.append(event)

        return unique_events

    def generate_knowledge_graph(
        self,
        subject: str,
        entities: List[Entity],
        relationships: List[Relationship],
        timeline: List[TimelineEvent]
    ) -> Dict:
        """
        Generate a knowledge graph structure.

        Args:
            subject: Main subject name
            entities: Extracted entities
            relationships: Extracted relationships
            timeline: Timeline events

        Returns:
            Knowledge graph as dictionary
        """
        # Build nodes
        nodes = [{
            'id': subject,
            'type': 'subject',
            'label': subject
        }]

        for entity in entities:
            nodes.append({
                'id': entity.name,
                'type': entity.entity_type,
                'label': entity.name,
                'wikipedia_url': entity.wikipedia_url,
                'mention_count': len(entity.mentions)
            })

        # Build edges
        edges = []
        for rel in relationships:
            edges.append({
                'source': rel.source,
                'target': rel.target,
                'type': rel.relationship_type,
                'confidence': rel.confidence
            })

        # Add temporal edges from timeline
        for event in timeline:
            for entity in event.entities_involved:
                edges.append({
                    'source': subject,
                    'target': entity,
                    'type': f"event_{event.event_type}",
                    'date': event.date,
                    'confidence': event.confidence
                })

        return {
            'subject': subject,
            'nodes': nodes,
            'edges': edges,
            'timeline': [
                {
                    'date': e.date,
                    'type': e.event_type,
                    'description': e.description,
                    'confidence': e.confidence
                }
                for e in timeline
            ],
            'statistics': {
                'total_entities': len(entities),
                'total_relationships': len(relationships),
                'timeline_events': len(timeline),
                'entity_types': dict(self._count_entity_types(entities))
            }
        }

    def _count_entity_types(self, entities: List[Entity]) -> Dict[str, int]:
        """Count entities by type."""
        counts = defaultdict(int)
        for entity in entities:
            counts[entity.entity_type] += 1
        return counts


if __name__ == "__main__":
    # Example usage
    extractor = EntityExtractor()

    # Test with sample text
    sample = """
    Dr. Debora Marks is a professor at Harvard Medical School.
    She collaborated with Chris Sander on protein structure prediction.
    In 2011, they published a paper in PLOS ONE.
    She received her PhD from Humboldt University in 2010.
    In 2016, she was awarded the Overton Prize by ISCB.
    """

    # Simulate research data structure
    research_data = {
        'sections': [
            {
                'heading': 'Test',
                'content': sample,
                'claims': []
            }
        ]
    }

    entities = extractor.extract_entities(research_data)
    print("Extracted entities:")
    for e in entities:
        print(f"  - {e.name} ({e.entity_type})")

    relationships = extractor.extract_relationships(research_data, entities, "Debora Marks")
    print("\nExtracted relationships:")
    for r in relationships:
        print(f"  - {r.source} --[{r.relationship_type}]--> {r.target}")

    timeline = extractor.build_timeline(research_data)
    print("\nTimeline:")
    for t in timeline:
        print(f"  - {t.date}: {t.description[:60]}...")
