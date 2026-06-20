import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createResearchSearchService,
  researchSearchConfigFromEnv
} from './research-service.js';
import { buildArxivQuery } from './providers/arxiv.js';
import { planResearchQueries } from './query-planner.js';
import type {
  ResearchSearchProvider,
  ResearchSearchProviderResult,
  ResearchSearchRequest
} from './types.js';

class FakeProvider implements ResearchSearchProvider {
  readonly id;

  constructor(
    id: ResearchSearchProvider['id'],
    private readonly handler: (request: ResearchSearchRequest) => ResearchSearchProviderResult
  ) {
    this.id = id;
  }

  async search(request: ResearchSearchRequest): Promise<ResearchSearchProviderResult> {
    return this.handler(request);
  }
}

describe('research search service', () => {
  it('plans domain and intent query expansions', () => {
    const plan = planResearchQueries({
      query: 'latest protein foundation model benchmark',
      maxQueries: 4
    });

    assert.equal(plan.interpretedIntent.intent, 'latest');
    assert.equal(plan.interpretedIntent.domain, 'biology');
    assert.ok(plan.generatedQueries.some((query) => query.includes('computational biology')));
  });

  it('builds arXiv queries with date filters', () => {
    assert.match(
      buildArxivQuery('AI for protein design latest 2026', 2024),
      /submittedDate:\[202401010000 TO 299912312359\]/
    );
  });

  it('reads provider toggles from environment', () => {
    const config = researchSearchConfigFromEnv({
      SCIFORGE_RESEARCH_ARXIV_ENABLED: 'false',
      SCIFORGE_RESEARCH_TAVILY_API_KEY: 'tvly-key',
      SCIFORGE_RESEARCH_MAX_RESULTS: '7'
    });

    assert.equal(config.arxivEnabled, false);
    assert.equal(config.tavilyEnabled, true);
    assert.equal(config.cnsEnabled, true);
    assert.equal(config.maxResults, 7);
  });

  it('searches selected sources and merges duplicate papers', async () => {
    const service = createResearchSearchService({
      arxivEnabled: true,
      biorxivEnabled: false,
      semanticScholarEnabled: true,
      semanticScholarApiKey: '',
      tavilyEnabled: true,
      tavilyApiKey: 'key',
      cnsEnabled: false,
      cnsDomains: [],
      maxResults: 5,
      timeoutMs: 1000
    }, {
      providers: {
        arxiv: new FakeProvider('arxiv', () => ({
          papers: [{
            title: 'Foundation Models for Molecules',
            authors: ['A. Author'],
            year: 2025,
            arxivId: '2501.00001',
            abstract: 'molecular generation benchmark',
            url: 'https://arxiv.org/abs/2501.00001',
            source: ['arxiv']
          }],
          webResults: [],
          diagnostics: [{ id: 'arxiv', enabled: true, available: true, resultCount: 1 }]
        })),
        semantic_scholar: new FakeProvider('semantic_scholar', () => ({
          papers: [{
            title: 'Foundation Models for Molecules',
            authors: ['A. Author', 'B. Author'],
            year: 2025,
            arxivId: '2501.00001',
            doi: '10.1234/example',
            citationCount: 12,
            abstract: 'molecular generation benchmark and evaluation',
            url: 'https://example.test/paper',
            source: ['semantic_scholar']
          }],
          webResults: [],
          diagnostics: [{ id: 'semantic_scholar', enabled: true, available: true, resultCount: 1 }]
        })),
        tavily: new FakeProvider('tavily', () => ({
          papers: [],
          webResults: [{
            title: 'Project page',
            url: 'https://example.test/project?utm=1',
            snippet: 'Open source implementation',
            source: 'tavily',
            rank: 1
          }],
          diagnostics: [{ id: 'tavily', enabled: true, available: true, resultCount: 1 }]
        }))
      }
    });

    const result = await service.search({
      query: 'molecular generation benchmark',
      sources: ['arxiv', 'semantic_scholar', 'web'],
      maxResults: 5
    });

    assert.equal(result.papers.length, 1);
    assert.deepEqual(result.papers[0]?.source.sort(), ['arxiv', 'semantic_scholar']);
    assert.equal(result.webResults.length, 1);
    assert.ok(result.citations.some((citation) => citation.source === 'arxiv,semantic_scholar'));
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.id === 'tavily' && diagnostic.available));
  });
});
