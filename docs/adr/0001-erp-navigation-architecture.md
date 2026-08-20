# ERP Navigation Architecture and Domain Taxonomy

## Status
Accepted

## Context
The application is transitioning from a task logger to an Enterprise Resource Planning (ERP) platform encompassing task execution, collaborative group tasks, human resources & leave management, sales opportunity registrations (SOR), procurement workflows, and system administration. The legacy navigation lumped links into ambiguous buckets (`Main`, `Management`, `Sales`, `Approvals`) with scattered imperative permission checks in `SideNav.jsx`.

## Decision
1. **Modular Domain-Driven Taxonomy**: Group sidebar links into discrete business modules:
   - **Workspace** (Personal / Self-Service: `Dashboard`, `My Tasks`, `My Leaves & Overtime`)
   - **Operations** (Execution: `Group Tasks`, `Task Templates`)
   - **Sales** (Commercial: `SOR Register`)
   - **Approvals** (Governance & Review: `Task Approvals`, `HR Verifications`)
   - **Human Resources** (Workforce: `Employee Directory`, `Leaves Manager`)
   - **Administration** (System Control: `System Admin`, `Activity Log`)
2. **Explicit Personal vs. Operational Tiering**: Retain a persistent top "Workspace" tier for personal employee actions, distinguishing personal leaves (`My Leaves & Overtime`) from managerial tools (`Leaves Manager`).
3. **Centralized Approval Center with Badges**: Aggregate cross-cutting approval queues into an Approvals module with live badge counters both on individual leaf links and summarized on collapsed module headers.
4. **Categorized Quick Actions**: Group the `+` quick action dropdown into domain categories (Personal, Operations, Sales) with role-based visibility.
5. **Smart Persistence**: Persist module accordion collapse/expand state in `localStorage` keyed by user ID.
6. **Declarative Navigation Schema**: Extract hardcoded conditionals from `SideNav.jsx` into a centralized, typed navigation registry (`src/constants/navigation.js`) with role/capability permission guards.

## Considered Options
- **Workflow / Action-Driven Taxonomy**: Rejected because business functions and permissions naturally map to organizational domains.
- **Dispersed Approval Queues**: Rejected due to cognitive friction for managers having to check multiple sub-pages for pending reviews.
- **Dynamic In-Component Push Array**: Rejected in favor of a declarative config to ensure consistency, testability, and extensibility across UI surfaces.
