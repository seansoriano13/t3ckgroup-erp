# T3CK Group ERP

The operational system and enterprise resource planning portal for T3CK Group, consolidating task workflows, workforce management, sales opportunities, and procurement.

## Language

### Navigation & Workspaces

**Workspace**:
The personal domain for an authenticated employee containing their own daily execution items, personal schedule, and self-service requests.
_Avoid_: Main, Home

**Self-Service**:
Actions and records where the acting user is the subject (e.g., logging individual tasks, applying for personal leaves or offset hours).
_Avoid_: Management, Admin

**Module**:
A cohesive business capability domain (e.g., Operations, Sales, Human Resources, Procurement, Administration) containing operational registers and administrative views.
_Avoid_: Category, Tab, Page Group

**Approval Center**:
A centralized cross-cutting hub where supervisors, department heads, and HR officers review and act on pending submission queues across domains.
_Avoid_: Approvals Tab, Verification Page

### Domain Modules & Entities

**SOR (Sales Opportunity Record)**:
A commercial deal registration tracking potential sales, client requirements, quotations, and special procurement requests.
_Avoid_: Opportunity, Lead, Deal

**SOR Register**:
The centralized index and management table of all registered Sales Opportunity Records.
_Avoid_: Opportunities Page, Opportunity Registration

**Offset**:
Compensatory time off or overtime adjustment claimed by an employee for hours worked outside standard shifts.
_Avoid_: Leave credit, OT slip

**Group Task**:
A collaborative project or shared task assignment involving multiple team members with defined roles and templates.
_Avoid_: Project, Shared Task

**Employee Directory**:
The workforce register and profile repository for company personnel.
_Avoid_: HR Management, User List
