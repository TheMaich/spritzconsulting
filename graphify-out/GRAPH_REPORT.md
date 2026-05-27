# Graph Report - .  (2026-05-22)

## Corpus Check
- 76 files · ~284,400 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 52 nodes · 78 edges · 8 communities (7 shown, 1 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 7 edges (avg confidence: 0.84)
- Token cost: 179,316 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Publishing Services Catalog|Publishing Services Catalog]]
- [[_COMMUNITY_Studios & Track Record|Studios & Track Record]]
- [[_COMMUNITY_IP Control & Discovery Call|IP Control & Discovery Call]]
- [[_COMMUNITY_Site Shell & i18n System|Site Shell & i18n System]]
- [[_COMMUNITY_Recoupment & Net Revenue|Recoupment & Net Revenue]]
- [[_COMMUNITY_Revenue Split & 5050|Revenue Split & 50/50]]
- [[_COMMUNITY_Resources Hub & FAQ|Resources Hub & FAQ]]
- [[_COMMUNITY_SEO  robots.txt|SEO / robots.txt]]

## God Nodes (most connected - your core abstractions)
1. `Spritz Consulting Homepage` - 19 edges
2. `Resources Index Page` - 12 edges
3. `Services Section (02)` - 10 edges
4. `Contact Section (04)` - 9 edges
5. `Michele Di Nardo (Miki)` - 8 edges
6. `Article: What '50/50' Actually Means` - 8 edges
7. `Article: You Own the IP. What For?` - 6 edges
8. `Article: Three Things to Read Before You Sign` - 6 edges
9. `Article: When Your Publisher Goes Quiet` - 5 edges
10. `Article: Marketing is Part of the Deal. So is the Invoice.` - 4 edges

## Surprising Connections (you probably didn't know these)
- `Resources Index Page` --conceptually_related_to--> `Mustard-on-Black Visual Design System`  [INFERRED]
  resources/index.html → index.html
- `Resources Index Page` --references--> `Spritz Consulting Homepage`  [EXTRACTED]
  resources/index.html → index.html
- `i18n Architecture Notes (dictionary.md)` --references--> `Spritz Consulting Homepage`  [EXTRACTED]
  dictionary.md → index.html
- `Article: What '50/50' Actually Means` --references--> `Spritz Consulting Homepage`  [EXTRACTED]
  resources/what-5050-means.html → index.html
- `Article: You Own the IP. What For?` --references--> `Spritz Consulting Homepage`  [EXTRACTED]
  resources/ip-ownership.html → index.html

## Hyperedges (group relationships)
- **Publishing Contract Pitfalls Cluster** — concept_net_revenue, concept_recoupment, concept_marketing_recoupment, concept_licence_scope_duration_reversion, concept_exit_rights, concept_cure_period [INFERRED 0.85]
- **Resources Article Collection** — resources_what_5050, resources_ip_ownership, resources_publisher_quiet, resources_marketing_invoice, resources_three_things [INFERRED 0.95]
- **Michele Di Nardo Career Path Across Studios** — index_michele_di_nardo, index_34bigthings, index_rebellion, index_raw_fury, index_untold_games [INFERRED 0.95]

## Communities (8 total, 1 thin omitted)

### Community 0 - "Publishing Services Catalog"
Cohesion: 0.22
Nodes (10): Age Rating Submissions (ESRB/PEGI/USK/CERO), Console Certification (PS/Xbox/Switch), Services Section (02), Service: Design Consultancy, Service: External Production Oversight, Service: Mock Reviews for In-Development Games, Service: Physical & Boxed Editions, Service: Platform & Release Management (+2 more)

### Community 1 - "Studios & Track Record"
Cohesion: 0.22
Nodes (9): 34BigThings, City 20 (game), My Experience Section (01), Indie Arena Booth, Michele Di Nardo (Miki), Rebellion, Scuola Nash, Spritz Consulting (Brand) (+1 more)

### Community 2 - "IP Control & Discovery Call"
Cohesion: 0.32
Nodes (8): Contract Exit Rights & Reversion Clauses, IP Ownership vs Control, Licence: Scope, Duration, Reversion, Contact Form (mailto), Contact Section (04), Discovery Call (30 min, free), Article: You Own the IP. What For?, Article: When Your Publisher Goes Quiet

### Community 3 - "Site Shell & i18n System"
Cohesion: 0.33
Nodes (7): i18n Architecture Notes (dictionary.md), Hero Section, i18n Language System (EN/IT/FR/ES), Studios & Games Marquee, Spritz Consulting Homepage, Testimonials Section, Dark/Light Theme System

### Community 4 - "Recoupment & Net Revenue"
Cohesion: 0.33
Nodes (6): Cure Period & Breach Provisions, Recoverable Marketing Budget, Net Revenue Definition, Recoupment Pool, Article: Marketing is Part of the Deal. So is the Invoice., Article: Three Things to Read Before You Sign

### Community 5 - "Revenue Split & 50/50"
Cohesion: 0.50
Nodes (5): Full-Service Publishing Deal, Revenue Split Percentage, Raw Fury, Service: Strategic Publishing Support, Article: What '50/50' Actually Means

### Community 6 - "Resources Hub & FAQ"
Cohesion: 0.40
Nodes (5): Mustard-on-Black Visual Design System, Engagement Rates & Formats, FAQ Section (03), Spritz Consulting LinkedIn, Resources Index Page

## Knowledge Gaps
- **14 isolated node(s):** `Spritz Consulting (Brand)`, `Hero Section`, `Studios & Games Marquee`, `Testimonials Section`, `Contact Form (mailto)` (+9 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Spritz Consulting Homepage` connect `Site Shell & i18n System` to `Publishing Services Catalog`, `Studios & Track Record`, `IP Control & Discovery Call`, `Recoupment & Net Revenue`, `Revenue Split & 50/50`, `Resources Hub & FAQ`, `SEO / robots.txt`?**
  _High betweenness centrality (0.498) - this node is a cross-community bridge._
- **Why does `Services Section (02)` connect `Publishing Services Catalog` to `Site Shell & i18n System`, `Revenue Split & 50/50`, `Resources Hub & FAQ`?**
  _High betweenness centrality (0.342) - this node is a cross-community bridge._
- **Why does `Michele Di Nardo (Miki)` connect `Studios & Track Record` to `Revenue Split & 50/50`?**
  _High betweenness centrality (0.258) - this node is a cross-community bridge._
- **What connects `Spritz Consulting (Brand)`, `Hero Section`, `Studios & Games Marquee` to the rest of the system?**
  _22 weakly-connected nodes found - possible documentation gaps or missing edges._