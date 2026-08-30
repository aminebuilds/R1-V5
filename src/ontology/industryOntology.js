/**
 * @file Multi-Industry Domain Ontology and Glossary for R. v1.
 * Provides hierarchical classification of commercial sectors, specialized verticals,
 * domain-specific glossaries, standard KPIs, spatial layer combinations, and Places/GIS search mappings.
 * @module ontology/industryOntology
 */

/**
 * @typedef {Object} IndustryVertical
 * @property {string} id - Unique identifier (e.g. 'fuel-convenience', 'automotive-ev').
 * @property {string} name - Human-readable name.
 * @property {string} sector - Parent sector ID.
 * @property {string} sectorName - Parent sector human-readable name.
 * @property {string} color - Hex/RGB accent color.
 * @property {string} icon - Material icon identifier.
 * @property {string[]} aliases - Common keywords and synonyms.
 * @property {Record<string, string>} glossary - Key terms, acronyms, and definitions.
 * @property {string[]} kpis - Core operational and market KPIs.
 * @property {string[]} recommendedLayers - Default layer IDs for this vertical.
 * @property {string[]} sampleQueries - Typical operator prompts.
 * @property {string[]} searchKeywords - Places / Overpass keyword search seeds.
 * @property {string} defaultStyle - Preferred visual/atmosphere style.
 */

/**
 * Industry Sectors taxonomy.
 * @type {Readonly<Record<string, {name: string, description: string, icon: string}>>}
 */
export const SECTORS = Object.freeze({
  'retail-consumer': Object.freeze({
    name: 'Retail & Consumer',
    description: 'Physical forecourts, storefronts, quick-serve retail, and consumer supply chains.',
    icon: 'storefront',
  }),
  'travel-logistics': Object.freeze({
    name: 'Travel & Logistics',
    description: 'Global airline routes, maritime shipping lanes, multi-modal freight, and intermodal hubs.',
    icon: 'local_shipping',
  }),
  'manufacturing-industrial': Object.freeze({
    name: 'Manufacturing & Industrial',
    description: 'Automotive assembly, chemical facilities, heavy construction, and industrial agriculture.',
    icon: 'precision_manufacturing',
  }),
  'energy-resources': Object.freeze({
    name: 'Energy & Resources',
    description: 'Power generation, grid distribution, hydrocarbon refining, and renewable assets.',
    icon: 'bolt',
  }),
  'tech-infrastructure': Object.freeze({
    name: 'Technology & Digital Infrastructure',
    description: 'Hyperscale datacenters, subsea fiber cables, cellular networks, and space systems.',
    icon: 'dns',
  }),
  'financial-services': Object.freeze({
    name: 'Financial Services & Insurance',
    description: 'Retail bank networks, capital exposure, catastrophe modeling, and asset risk.',
    icon: 'account_balance',
  }),
  'healthcare-life-sciences': Object.freeze({
    name: 'Healthcare & Life Sciences',
    description: 'Hospital footprints, clinical trial sites, biotech research, and medical logistics.',
    icon: 'medical_services',
  }),
  'communications-media': Object.freeze({
    name: 'Communications, Media & Entertainment',
    description: 'Digital advertising footprints, studio campuses, gaming centers, and media distribution.',
    icon: 'podcasts',
  }),
  'public-sector': Object.freeze({
    name: 'Public Sector & Services',
    description: 'Higher education campuses, municipal utilities, transit authorities, and aerospace defense.',
    icon: 'account_balance',
  }),
});

/**
 * Complete Verticals Catalog with rich glossaries and metric dictionaries.
 * @type {Readonly<Record<string, IndustryVertical>>}
 */
export const VERTICALS = Object.freeze({
  'fuel-convenience': Object.freeze({
    id: 'fuel-convenience',
    name: 'Fuel & Convenience',
    sector: 'retail-consumer',
    sectorName: 'Retail & Consumer',
    color: '#36dcff',
    icon: 'local_gas_station',
    aliases: ['gas station', 'convenience store', 'c-store', 'petrol', 'forecourt', 'fueling', 'truck stop', 'travel plaza', 'wawa', "casey's", "buc-ee's", 'circle k', '7-eleven', 'loves', 'pilot flying j'],
    glossary: {
      'Forecourt': 'The open area outside a service station where fuel dispensers and vehicle charging bays are located.',
      'C-Store (Convenience Store)': 'Small-format retail store offering packaged goods, foodservice, and essential merchandise.',
      'MPD (Multi-Product Dispenser)': 'Fuel dispensing unit capable of delivering multiple grades of fuel and diesel.',
      'Inside Sales / Merch Margins': 'Revenue generated from merchandise, hot food, and non-fuel sales, carrying higher profit margins than fuel.',
      'Site Gap Score': 'Algorithmic measure of unsatisfied local consumer demand in a catchment area vs competitor density.',
      'Forecourt Congestion Index': 'Real-time vehicle queue delay index on adjacent access roads and turn lanes.',
    },
    kpis: [
      'Forecourt Traffic Queue',
      'Site Opportunity Gap',
      'Competitor Density Radius (3 mi)',
      'Severe Weather Proximity',
      'Corridor Daily Vehicle Volume',
      'Foodservice Delivery Catchment',
    ],
    recommendedLayers: ['sites', 'traffic', 'earthquakes'],
    sampleQueries: [
      "Casey's stores in Iowa near I-80",
      "Wawa locations with high traffic in Philadelphia",
      "Buc-ee's travel centers in Texas",
      "Circle K sites exposed to severe storm warnings",
    ],
    searchKeywords: ['gas station', 'convenience store', 'truck stop', 'travel plaza', 'fuel center'],
    defaultStyle: 'cyberpunk',
  }),

  'automotive-ev': Object.freeze({
    id: 'automotive-ev',
    name: 'Automotive & EV Mobility',
    sector: 'manufacturing-industrial',
    sectorName: 'Manufacturing & Industrial',
    color: '#a855f7',
    icon: 'electric_car',
    aliases: ['ev charging', 'tesla', 'supercharger', 'electrify america', 'dealership', 'assembly plant', 'gigafactory', 'automotive', 'oem', 'ford', 'gm', 'toyota', 'rivian', 'lucid'],
    glossary: {
      'DC Fast Charging (DCFC)': 'High-voltage Direct Current charging stations (50kW to 350kW+) providing 80% charge in under 30 minutes.',
      'Megawatt Charging System (MCS)': 'Next-generation charging standard for heavy-duty commercial freight electric vehicles.',
      'Gigafactory': 'Large-scale manufacturing facility dedicated to lithium-ion battery cells and EV assembly.',
      'Grid Interconnect Capacity': 'Maximum available power feed from local substation to support high-draw charging banks.',
      'Corridor Density': 'Spacing of EV charging hubs along major interstate freight and passenger routes (target <50 mi).',
    },
    kpis: [
      'Substation Proximity & Capacity',
      'Corridor Charge Gap Index',
      'Traffic Throughput Rate',
      'Co-Located Retail Footfall',
      'Extreme Heat / Cold Efficiency Factor',
    ],
    recommendedLayers: ['sites', 'traffic', 'local-datacenters'],
    sampleQueries: [
      'Tesla Superchargers along I-5 corridor',
      'Electrify America stations in Southern California',
      'Automotive assembly plants near Detroit',
      'EV fast-charging hubs near shopping centers',
    ],
    searchKeywords: ['EV charging station', 'Tesla Supercharger', 'car dealership', 'automotive manufacturing', 'battery plant'],
    defaultStyle: 'terminal',
  }),

  'airlines-aviation': Object.freeze({
    id: 'airlines-aviation',
    name: 'Airlines & Aviation',
    sector: 'travel-logistics',
    sectorName: 'Travel & Logistics',
    color: '#3b82f6',
    icon: 'flight',
    aliases: ['airline', 'airport', 'aviation', 'flight', 'air freight', 'hangar', 'runway', 'airspace', 'delta', 'united', 'american airlines', 'boeing', 'airbus', 'fedex express', 'ups airlines'],
    glossary: {
      'ADS-B (Automatic Dependent Surveillance-Broadcast)': 'Satellite tracking technology where aircraft broadcast real-time GPS position, altitude, and velocity.',
      'Hub-and-Spoke': 'Transit network topology routing passenger and cargo flights through central hub airports.',
      'Turnaround Time (TAT)': 'Elapsed time between an aircraft docking at a gate and pushing back for its next leg.',
      'NOTAM (Notice to Air Missions)': 'Time-sensitive advisory published to warn pilots of hazardous conditions or runway closures.',
      'Holding Pattern': 'Standardized flight maneuver designed to delay an aircraft in flight when an airport is congested.',
    },
    kpis: [
      'Active Airborne Density',
      'Terminal Area Convective Storm Risk',
      'Runway Throughput / Hourly Slots',
      'Military Airspace Restriction Overlap',
      'Crosswind / Visibility Limits',
    ],
    recommendedLayers: ['flights', 'military', 'weather-openmeteo'],
    sampleQueries: [
      'Track commercial flights inbound to Atlanta Hartsfield',
      'Airports with active thunderstorm advisories',
      'Cargo freighters operating across the Pacific',
      'London Heathrow terminal arrival queues',
    ],
    searchKeywords: ['airport', 'international airport', 'air cargo terminal', 'hangar', 'airfield'],
    defaultStyle: 'tactical',
  }),

  'maritime-shipping': Object.freeze({
    id: 'maritime-shipping',
    name: 'Maritime & Shipping',
    sector: 'travel-logistics',
    sectorName: 'Travel & Logistics',
    color: '#06b6d4',
    icon: 'directions_boat',
    aliases: ['vessel', 'container ship', 'tanker', 'port', 'harbor', 'ais', 'cargo', 'bulk carrier', 'maersk', 'msc', 'cosco', 'cma cgm', 'chokepoint', 'suez', 'panama canal'],
    glossary: {
      'AIS (Automatic Identification System)': 'VHF-based coastal and satellite transponder system for tracking maritime vessels.',
      'TEU (Twenty-Foot Equivalent Unit)': 'Standardized unit of measurement for cargo capacity on container ships and terminal yards.',
      'Chokepoint': 'Narrow strategic maritime waterway with heavy traffic (e.g. Malacca, Suez, Panama, Hormuz, Bab-el-Mandeb).',
      'Draft (Draught)': 'Vertical distance between the waterline and the bottom of the hull, dictating canal and berth accessibility.',
      'Anchorage Waiting Time': 'Time cargo vessels remain queued outside port boundaries awaiting terminal berthing clearance.',
    },
    kpis: [
      'Port Berth Queuing Delay',
      'Chokepoint Transit Velocity',
      'Severe Gale / Tropical Wave Proximity',
      'Under-Keel Clearance vs Depth',
      'Bunker Fuel Optimization Factor',
    ],
    recommendedLayers: ['marine', 'weather-openmeteo', 'telegeography-submarine-cables'],
    sampleQueries: [
      'Container vessels queued outside Port of Los Angeles',
      'Oil tankers navigating the Strait of Malacca',
      'Vessels in typhoon trajectory in South China Sea',
      'Rotterdam port vessel arrivals',
    ],
    searchKeywords: ['port', 'container terminal', 'harbor', 'marina', 'shipyard'],
    defaultStyle: 'crt-green',
  }),

  'datacenters-cloud': Object.freeze({
    id: 'datacenters-cloud',
    name: 'Datacenters & Cloud Infrastructure',
    sector: 'tech-infrastructure',
    sectorName: 'Technology & Digital Infrastructure',
    color: '#10b981',
    icon: 'dns',
    aliases: ['datacenter', 'data center', 'hyperscale', 'colocation', 'cloud', 'server farm', 'fiber landing', 'aws', 'azure', 'google cloud', 'equinix', 'digital realty'],
    glossary: {
      'PUE (Power Usage Effectiveness)': 'Ratio of total facility energy used compared to the energy delivered directly to IT computing equipment.',
      'Subsea Cable Landing Station (CLS)': 'Coastal facility where international deep-sea optical fiber cables connect to terrestrial land networks.',
      'Dark Fiber': 'Unlit optical fiber infrastructure deployed along right-of-ways, leasing optical bandwidth on demand.',
      'Availability Zone (AZ)': 'Isolated datacenter location within a cloud region engineered to be immune to shared single-point failures.',
      'Thermal Headroom': 'Margin between operational ambient heat and critical datacenter thermal shutdown limits.',
    },
    kpis: [
      'Subsea Cable Proximity & Diversity',
      'Seismic / Wildfire Threat Proximity',
      'Power Grid Substation Reliability',
      'Ambient Cooling Efficiency Headroom',
      'Fiber Latency Round-Trip-Time (ms)',
    ],
    recommendedLayers: ['local-datacenters', 'telegeography-submarine-cables', 'earthquakes', 'local-firms'],
    sampleQueries: [
      'Hyperscale datacenters in Northern Virginia (Ashburn)',
      'Subsea cable landings near Marseille and Singapore',
      'Datacenters within 50 miles of active wildfire perimeters',
      'Frankfurt cloud availability zones',
    ],
    searchKeywords: ['data center', 'telecommunications facility', 'subsea cable station', 'server farm'],
    defaultStyle: 'cyberpunk',
  }),

  'energy-utilities': Object.freeze({
    id: 'energy-utilities',
    name: 'Energy & Utilities',
    sector: 'energy-resources',
    sectorName: 'Energy & Resources',
    color: '#eab308',
    icon: 'bolt',
    aliases: ['power plant', 'grid', 'substation', 'solar farm', 'wind farm', 'hydroelectric', 'dam', 'refinery', 'chevron', 'exxonmobil', 'nextera', 'duke energy'],
    glossary: {
      'Hydroelectric Head': 'Vertical difference in water level between intake reservoir and tailrace turbine discharge.',
      'Nameplate Capacity (MW)': 'Maximum rated electrical power output a generator or plant is designed to sustain.',
      'Grid Curtailment': 'Intentional reduction in power generation (often solar/wind) when transmission capacity is constrained.',
      'Right-of-Way (ROW)': 'Designated strip of land occupied by high-voltage transmission lines or petroleum pipelines.',
      'Inundation Zone': 'Land area downstream of a reservoir or dam vulnerable to flooding upon sudden discharge or breach.',
    },
    kpis: [
      'Reservoir Storage Headroom',
      'Thermal Generation Cooling Inflow',
      'High-Wind / Severe Weather Threat',
      'Downstream Inundation Vulnerability',
      'Grid Interconnection Proximity',
    ],
    recommendedLayers: ['local-dams', 'earthquakes', 'weather-openmeteo', 'local-firms'],
    sampleQueries: [
      'Hydroelectric dams and reservoir storage in the Columbia River Basin',
      'Power plants exposed to active wildfire perimeters in California',
      'Substations near recent earthquake epicenters',
      'Solar farms in West Texas',
    ],
    searchKeywords: ['hydroelectric dam', 'power plant', 'electrical substation', 'solar farm', 'wind farm'],
    defaultStyle: 'terminal',
  }),

  'apparel-fashion': Object.freeze({
    id: 'apparel-fashion',
    name: 'Apparel & Fashion',
    sector: 'retail-consumer',
    sectorName: 'Retail & Consumer',
    color: '#f43f5e',
    icon: 'checkroom',
    aliases: ['clothing', 'fashion', 'apparel', 'boutique', 'luxury retail', 'department store', 'footwear', 'nike', 'zara', 'h&m', 'uniqlo', 'lvmh', 'gucci', 'nordstrom'],
    glossary: {
      'Footfall Density': 'Pedestrian foot traffic volume per hour within immediate storefront frontage zone.',
      'Flagship Corridor': 'Prestigious high-rent commercial street known for flagship retail experiences (e.g. 5th Ave, Champs-Élysées, Ginza).',
      'Cannibalization Index': 'Percentage of revenue expected to shift from existing fleet stores when opening a new nearby location.',
      'Trade Area Capture': 'Percentage of total target demographic shoppers within a 15-minute isochrone choosing a specific store.',
    },
    kpis: [
      'High-Street Footfall Index',
      'Co-Tenant Synergy Score',
      'Storefront Density Radius',
      'Transit Proximity (Metro / Bus)',
      'Local Disposable Income Benchmark',
    ],
    recommendedLayers: ['sites', 'traffic'],
    sampleQueries: [
      'Zara and H&M stores in Manhattan shopping corridors',
      'Luxury fashion boutiques on Bond Street London',
      'Footwear retail distribution across Tokyo',
      'High foot traffic shopping centers in Miami',
    ],
    searchKeywords: ['clothing store', 'fashion boutique', 'department store', 'shopping mall', 'shoe store'],
    defaultStyle: 'cyberpunk',
  }),

  'agriculture-commodities': Object.freeze({
    id: 'agriculture-commodities',
    name: 'Agriculture & Commodities',
    sector: 'manufacturing-industrial',
    sectorName: 'Manufacturing & Industrial',
    color: '#84cc16',
    icon: 'agriculture',
    aliases: ['farm', 'grain elevator', 'crop', 'agribusiness', 'fertilizer', 'silo', 'food processing', 'cargill', 'adm', 'bunge', 'deere', 'corteva'],
    glossary: {
      'NDVI (Normalized Difference Vegetation Index)': 'Satellite optical measure of green vegetation density and crop health.',
      'Soil Moisture Deficit': 'Difference between field water capacity and current soil moisture levels affecting crop yield.',
      'Grain Elevator Hub': 'Storage tower facility receiving, cleaning, and loading grain onto bulk freight rail or barges.',
      'Cold Chain Logistics': 'Temperature-controlled supply chain for perishable produce, dairy, and meat products.',
    },
    kpis: [
      'Crop Stress / Drought Severity Index',
      'Rail Head Elevator Congestion',
      'Hail / Frost Threat Proximity',
      'Barge Navigability Water Levels',
      'Feedstock Supply Proximity',
    ],
    recommendedLayers: ['weather-openmeteo', 'local-dams', 'earthquakes'],
    sampleQueries: [
      'Grain export terminals along the Mississippi River',
      'Agricultural processing facilities in the Midwest',
      'Fertilizer distribution hubs near freight corridors',
      'Crop zones exposed to frost advisories',
    ],
    searchKeywords: ['grain elevator', 'agricultural cooperative', 'farm supply', 'food processing plant'],
    defaultStyle: 'tactical',
  }),

  'banking-financial': Object.freeze({
    id: 'banking-financial',
    name: 'Banking & Financial Services',
    sector: 'financial-services',
    sectorName: 'Financial Services & Insurance',
    color: '#ec4899',
    icon: 'account_balance',
    aliases: ['bank', 'branch', 'atm', 'wealth management', 'credit union', 'fintech', 'insurance', 'jpmorgan chase', 'bank of america', 'wells fargo', 'citi', 'goldman sachs'],
    glossary: {
      'Branch Density': 'Number of physical banking branches per 10,000 population in a metropolitan market.',
      'Deposit Market Share': 'Total dollar value of consumer and commercial deposits held in local geographic territory.',
      'Catastrophe Exposure (Cat Risk)': 'Insured commercial asset value located within high-risk flood, quake, or hurricane zones.',
      'ATM Fleet Uptime': 'Operational availability percentage across distributed cash machine networks.',
    },
    kpis: [
      'Deposit Market Penetration',
      'Competitor Branch Overlap',
      'Catastrophe Zone Exposure',
      'Commercial Hub Proximity',
      'Pedestrian Accessibility Score',
    ],
    recommendedLayers: ['sites', 'earthquakes', 'local-firms'],
    sampleQueries: [
      'Chase and Bank of America branches in Chicago',
      'Commercial bank branches in Downtown San Francisco',
      'Financial centers exposed to hurricane surge zones',
      'ATM network coverage in urban transit hubs',
    ],
    searchKeywords: ['bank', 'bank branch', 'credit union', 'financial institution', 'wealth management'],
    defaultStyle: 'terminal',
  }),

  'clinical-trials-healthcare': Object.freeze({
    id: 'clinical-trials-healthcare',
    name: 'Clinical Trials & Healthcare',
    sector: 'healthcare-life-sciences',
    sectorName: 'Healthcare & Life Sciences',
    color: '#fb7185',
    icon: 'medical_services',
    aliases: ['hospital', 'clinical trial', 'medical center', 'biotech', 'pharmacy', 'lab', 'healthcare', 'pfizer', 'johnson & johnson', 'novartis', 'roche', 'mayo clinic'],
    glossary: {
      'Site Principal Investigator (PI)': 'Lead physician responsible for the independent clinical execution of a study trial at a facility.',
      'Patient Catchment Area': 'Geographic demographic radius from which clinical trial participants and patients can reliably commute.',
      'Bio-Storage Cold Chain (-80°C)': 'Specialized cryogenic refrigeration for biologics, vaccines, and genetic therapy vials.',
      'IRB (Institutional Review Board)': 'Governing committee that reviews and monitors biomedical research involving human subjects.',
    },
    kpis: [
      'Patient Demographic Catchment',
      'Academic Medical Center Proximity',
      'Airport Transit Commute Time',
      'Cold Chain Backup Reliability',
      'Regional Trial Density Overlap',
    ],
    recommendedLayers: ['sites', 'traffic'],
    sampleQueries: [
      'Major research hospitals in Boston / Cambridge area',
      'Clinical trial sites and oncology centers in Texas Medical Center',
      'Biotech laboratories near South San Francisco',
      'Hospital facilities within severe weather impact zones',
    ],
    searchKeywords: ['hospital', 'medical center', 'biomedical research', 'clinical laboratory', 'cancer center'],
    defaultStyle: 'cyberpunk',
  }),

  'construction-heavy': Object.freeze({
    id: 'construction-heavy',
    name: 'Construction & Heavy Engineering',
    sector: 'manufacturing-industrial',
    sectorName: 'Manufacturing & Industrial',
    color: '#d97706',
    icon: 'construction',
    aliases: ['construction', 'concrete plant', 'quarry', 'cement', 'contractor', 'heavy equipment', 'infrastructure', 'caterpillar', 'cemex', 'vulcan materials', 'bechtel'],
    glossary: {
      'Batch Plant Radius': 'Maximum transit time (typically <90 min) ready-mix concrete can travel before chemical curing begins.',
      'Laydown Yard': 'Designated open area near construction sites for staging heavy structural steel, precast concrete, and cranes.',
      'Aggregate Haul Distance': 'Distance from sand/gravel quarry to project site directly governing material haulage costs.',
    },
    kpis: [
      'Ready-Mix Batch Plant Transit Isoline',
      'Heavy Haul Freight Corridor Access',
      'Permitting / Environmental Setback',
      'Extreme Rain / Freeze Delay Risk',
    ],
    recommendedLayers: ['sites', 'traffic', 'weather-openmeteo'],
    sampleQueries: [
      'Concrete batch plants and quarries near Phoenix',
      'Heavy equipment staging yards in Dallas Fort Worth',
      'Infrastructure projects exposed to high wind warnings',
    ],
    searchKeywords: ['concrete plant', 'ready mix supplier', 'quarry', 'construction equipment dealer', 'building materials'],
    defaultStyle: 'tactical',
  }),

  'space-aerospace': Object.freeze({
    id: 'space-aerospace',
    name: 'Space & Aerospace Defense',
    sector: 'public-sector',
    sectorName: 'Public Sector & Services',
    color: '#8b5cf6',
    icon: 'rocket_launch',
    aliases: ['space', 'satellite', 'tle', 'orbit', 'launch pad', 'spaceport', 'defense', 'military', 'spacex', 'nasa', 'lockheed martin', 'northrop grumman', 'blue origin'],
    glossary: {
      'TLE (Two-Line Element Set)': 'Standardized data format encoding Keplerian orbital parameters of Earth-orbiting satellites.',
      'Apogee / Perigee': 'Points in an elliptical orbit furthest from (apogee) and closest to (perigee) the center of the Earth.',
      'Inclination': 'Angle between the orbital plane of a satellite and the Earth’s equatorial plane.',
      'Downrange Launch Corridor': 'Trajectory path over ocean or unpopulated terrain reserved during orbital launch window.',
    },
    kpis: [
      'Orbital Crossing Conjunction Risk',
      'Atmospheric Wind Shear at Altitude',
      'Launch Pad Ground Winds',
      'Telemetry Downlink Horizon Coverage',
    ],
    recommendedLayers: ['satellites', 'military', 'weather-openmeteo'],
    sampleQueries: [
      'Active satellites passing over the North American continent',
      'Spaceport launch pads at Cape Canaveral and Vandenberg',
      'Military airspace and surveillance coverage zones',
      'Starlink constellation orbital planes',
    ],
    searchKeywords: ['spaceport', 'launch facility', 'aerospace engineering', 'air force base', 'space center'],
    defaultStyle: 'tactical',
  }),
});

/**
 * Returns all available vertical definitions as an array.
 * @returns {IndustryVertical[]}
 */
export function getAllVerticals() {
  return Object.values(VERTICALS);
}

/**
 * Find vertical by ID.
 * @param {string} id
 * @returns {IndustryVertical|null}
 */
export function getVerticalById(id) {
  return VERTICALS[id] || null;
}

/**
 * Find all verticals under a given sector ID.
 * @param {string} sectorId
 * @returns {IndustryVertical[]}
 */
export function getVerticalsBySector(sectorId) {
  return Object.values(VERTICALS).filter((v) => v.sector === sectorId);
}
