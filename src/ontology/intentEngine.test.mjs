import test from 'node:test';
import assert from 'node:assert/strict';
import { VERTICALS, SECTORS, getAllVerticals, getVerticalById, getVerticalsBySector } from './industryOntology.js';
import { resolveCommercialIntent, formatCommercialBrief } from './intentEngine.js';

test('Industry Ontology has all major sectors and vertical definitions', () => {
  const verticals = getAllVerticals();
  assert.ok(verticals.length >= 10, 'Expected at least 10 core verticals');

  const requiredVerticals = [
    'fuel-convenience',
    'automotive-ev',
    'airlines-aviation',
    'maritime-shipping',
    'datacenters-cloud',
    'energy-utilities',
    'apparel-fashion',
    'agriculture-commodities',
    'banking-financial',
    'clinical-trials-healthcare',
    'construction-heavy',
    'space-aerospace',
  ];

  for (const id of requiredVerticals) {
    const v = getVerticalById(id);
    assert.ok(v, `Missing vertical: ${id}`);
    assert.ok(v.glossary && Object.keys(v.glossary).length > 0, `Vertical ${id} must have a glossary`);
    assert.ok(v.kpis && v.kpis.length > 0, `Vertical ${id} must have KPIs`);
    assert.ok(v.recommendedLayers && v.recommendedLayers.length > 0, `Vertical ${id} must have layers`);
  }
});

test('Intent Engine correctly classifies automotive & EV charging intents', () => {
  const res = resolveCommercialIntent('Tesla Superchargers near Austin with traffic');
  assert.equal(res.vertical.id, 'automotive-ev');
  assert.equal(res.confidence, 'high');
  assert.ok(res.layersToEnable.includes('traffic'));
  assert.ok(res.layersToEnable.includes('sites'));
});

test('Intent Engine correctly classifies maritime container ship intents', () => {
  const res = resolveCommercialIntent('Maersk container vessels entering Rotterdam port with weather');
  assert.equal(res.vertical.id, 'maritime-shipping');
  assert.equal(res.confidence, 'high');
  assert.ok(res.layersToEnable.includes('marine'));
  assert.ok(res.layersToEnable.includes('weather-openmeteo'));
});

test('Intent Engine correctly classifies aviation intents', () => {
  const res = resolveCommercialIntent('Delta flights inbound to Atlanta airport');
  assert.equal(res.vertical.id, 'airlines-aviation');
  assert.equal(res.confidence, 'high');
  assert.ok(res.layersToEnable.includes('flights'));
});

test('Intent Engine correctly classifies datacenters and cloud infrastructure', () => {
  const res = resolveCommercialIntent('AWS datacenter latency and subsea cables in Marseille');
  assert.equal(res.vertical.id, 'datacenters-cloud');
  assert.equal(res.confidence, 'high');
  assert.ok(res.layersToEnable.includes('local-datacenters'));
  assert.ok(res.layersToEnable.includes('telegeography-submarine-cables'));
});

test('Intent Engine correctly classifies retail and fuel forecourt intents', () => {
  const res = resolveCommercialIntent("Casey's stores in Iowa along I-80 forecourt queue");
  assert.equal(res.vertical.id, 'fuel-convenience');
  assert.equal(res.confidence, 'high');
  assert.ok(res.layersToEnable.includes('sites'));
  assert.ok(res.layersToEnable.includes('traffic'));
});

test('Intent Engine handles conversational natural language queries like show me all wawas on a map', () => {
  const res = resolveCommercialIntent("show me all wawa's in a map/");
  assert.equal(res.vertical.id, 'fuel-convenience');
  assert.equal(res.confidence, 'high');
  assert.equal(res.cleanedSearchQuery, "wawa's");
  assert.ok(res.layersToEnable.includes('sites'));
});
