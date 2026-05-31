import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HTML = readFileSync(join(process.cwd(), 'ui', 'index.html'), 'utf-8');
const CSS = readFileSync(join(process.cwd(), 'ui', 'crucibulum.css'), 'utf-8');

describe('Symposium UI redesign', () => {
  describe('Simple / Advanced Lab modes', () => {
    it('HTML contains Simple and Advanced Lab toggle buttons', () => {
      assert.ok(HTML.includes("setViewMode('simple')"), 'missing Simple mode toggle');
      assert.ok(HTML.includes("setViewMode('advanced')"), 'missing Advanced mode toggle');
    });
    it('HTML contains view-toggle class', () => {
      assert.ok(HTML.includes('view-toggle'), 'missing view-toggle wrapper');
    });
    it('Simple button text is present', () => {
      assert.ok(HTML.includes('>Simple</button>'), 'missing Simple button label');
    });
    it('Advanced Lab button text is present', () => {
      assert.ok(HTML.includes('>Advanced Lab</button>'), 'missing Advanced Lab button label');
    });
  });

  describe('certification labels near provider/model picker', () => {
    it('RELEASE_CERTIFICATION object exists in HTML', () => {
      assert.ok(HTML.includes('RELEASE_CERTIFICATION'), 'missing RELEASE_CERTIFICATION');
    });
    it('certification labels include certified targets', () => {
      assert.ok(HTML.includes('Certified release target') || HTML.includes('certificationLabel'), 'missing certification label');
    });
    it('renderReleaseCertificationBanner function exists', () => {
      assert.ok(HTML.includes('renderReleaseCertificationBanner'), 'missing release certification banner renderer');
    });
  });

  describe('family navigation includes all visible families', () => {
    const expectedTabs = ['dashboard', 'personality', 'benchmark', 'poison', 'build', 'safety', 'memory', 'tools', 'trust', 'providers'];
    for (const tab of expectedTabs) {
      it(`TAB_CONFIG contains "${tab}"`, () => {
        assert.ok(HTML.includes(`key:'${tab}'`), `missing TAB_CONFIG entry for ${tab}`);
      });
    }
    it('renderTabs function exists', () => {
      assert.ok(HTML.includes('function renderTabs'), 'missing renderTabs function');
    });
  });

  describe('advanced metadata is collapsible', () => {
    it('isSimpleView function exists', () => {
      assert.ok(HTML.includes('function isSimpleView'), 'missing isSimpleView');
    });
    it('isAdvancedView function exists', () => {
      assert.ok(HTML.includes('function isAdvancedView'), 'missing isAdvancedView');
    });
    it('advanced sections are gated by isAdvancedView', () => {
      assert.ok(HTML.includes("isAdvancedView()?"), 'no conditional rendering using isAdvancedView');
    });
    it('simple sections are gated by isSimpleView', () => {
      assert.ok(HTML.includes("isSimpleView()?"), 'no conditional rendering using isSimpleView');
    });
  });

  describe('failure panel includes classification/stage/reason', () => {
    it('verdict label is present in focused run', () => {
      assert.ok(HTML.includes('verdictLabel'), 'missing verdictLabel in run display');
    });
    it('verdict summary / reason is present', () => {
      assert.ok(HTML.includes('verdictSummary'), 'missing verdictSummary');
    });
    it('failure origin bucket is classified', () => {
      assert.ok(HTML.includes('originBucket'), 'missing origin classification');
    });
    it('model failure flag is present', () => {
      assert.ok(HTML.includes('isModelFailure'), 'missing isModelFailure classification');
    });
    it('infra issue flag is present', () => {
      assert.ok(HTML.includes('isInfraIssue'), 'missing isInfraIssue classification');
    });
  });

  describe('no generic unclassified failure string as primary UI state', () => {
    it('does not use "Could not start" as a standalone primary state', () => {
      // The string "Could not start" may appear in backend data but should not
      // be the only visible failure label in the UI.
      const unclassifiedPattern = /class="[^"]*badge[^"]*">\s*Could not start\s*</;
      assert.ok(!unclassifiedPattern.test(HTML), 'unclassified "Could not start" found as primary badge');
    });
  });

  describe('mobile viewport compatibility', () => {
    it('CSS contains 720px mobile breakpoint', () => {
      assert.ok(CSS.includes('max-width:720px'), 'missing 720px breakpoint');
    });
    it('CSS contains 420px narrow breakpoint', () => {
      assert.ok(CSS.includes('max-width:420px'), 'missing 420px breakpoint');
    });
    it('tabs are responsive on mobile', () => {
      assert.ok(CSS.includes('.tab{flex:1 1 calc(50%') || CSS.includes('.tab{flex-basis:100%'), 'tabs not responsive');
    });
    it('viewport meta tag is present', () => {
      assert.ok(HTML.includes('viewport'), 'missing viewport meta tag');
    });
  });

  describe('Symposium design token alignment', () => {
    it('CSS uses indigo/violet background palette', () => {
      assert.ok(CSS.includes('--bg-0:#0c0a1a'), 'missing indigo background token');
    });
    it('CSS has readable text color on violet surface', () => {
      assert.ok(CSS.includes('--ink:#f0eaff'), 'missing readable ink token for violet palette');
    });
    it('CSS removed heavy underwater effects', () => {
      assert.ok(!CSS.includes('bioluminescent particulate'), 'still has underwater effects description');
    });
    it('CSS uses violet-based border-subtle token', () => {
      assert.ok(CSS.includes('--border-subtle:rgba(139,92,246'), 'border-subtle should use violet');
    });
    it('CSS has type scale variables', () => {
      assert.ok(CSS.includes('--text-base:14px'), 'missing text-base token');
      assert.ok(CSS.includes('--text-lg:16px'), 'missing text-lg token');
    });
    it('CSS uses cyan as primary signal color', () => {
      assert.ok(CSS.includes('--cyan:#22d3ee'), 'missing cyan signal');
    });
    it('CSS uses violet accent', () => {
      assert.ok(CSS.includes('--violet:#8b5cf6'), 'missing violet accent');
    });
    it('CSS uses magenta/pink highlight', () => {
      assert.ok(CSS.includes('--magenta:#ec4899'), 'missing magenta highlight');
    });
    it('hero has violet glow', () => {
      assert.ok(CSS.includes('glow-violet'), 'missing violet glow on hero');
    });
    it('no hero Peh (ab-squid display:none)', () => {
      assert.ok(CSS.includes('.ab-squid{display:none}'), 'hero squid should be hidden');
    });
    it('Peh exists somewhere visible (header or footer mascot)', () => {
      // The footer-squid CSS hook remains for legacy compatibility, but
      // operator moved the visible mascot to the cmd-rail header so it
      // is actually seen. Either placement satisfies the contract.
      assert.ok(CSS.includes('.footer-squid'), 'missing footer-squid CSS hook');
      const headerMascot = HTML.includes('cmd-rail-mascot') && CSS.includes('.cmd-rail-mascot');
      const footerMascot = HTML.includes('footer-squid');
      assert.ok(headerMascot || footerMascot, 'no Peh mascot found in either header or footer');
    });
    it('tab active state uses violet gradient', () => {
      assert.ok(CSS.includes('.tab.active') && CSS.includes('139,92,246'), 'tab active should use violet');
    });
  });
});
