# Worknest backend

Node.js API using Express, Mongoose, and an httpOnly session cookie stored in MongoDB.

## Install

```bash
cp .env.example .env
npm install
```

`.env.example` sets `PORT`, `MONGODB_URI`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `SESSION_SECRET`. The first startup with an empty database creates an organization named Worknest and one admin from `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

## Run MongoDB

The API expects MongoDB at `mongodb://127.0.0.1:27017/worknest`.

Start a local MongoDB server, for example:

```bash
mongod --dbpath ~/worknest-mongo-data
```

Or with Docker:

```bash
docker run --name worknest-mongo -p 27017:27017 -d mongo:7
```

The API process still starts when MongoDB is down. `GET /health` reports the current connection state (`disconnected`, `connecting`, `connected`, or `disconnecting`). Sign-in stays unavailable until MongoDB is connected.

## Start the API

```bash
npm start
```

For restart-on-change during development:

```bash
npm run dev
```

Health check: [http://localhost:4000/health](http://localhost:4000/health)

## Auth

Sessions use the `worknest.sid` cookie: httpOnly, SameSite=Lax, and Secure=false so local HTTP works. The browser origin `http://localhost:5173` is allowed with credentials.

- `POST /auth/login` with `{ email, password }`
- `POST /auth/logout`
- `GET /auth/me`
- `POST /users` admin only, `{ name, email, password, role }`
- `GET /users` admin only, users in the same organization, no password hashes

Each user has one role: `admin`, `hr`, `manager`, or `employee`.

## Projects and tasks

Every route below requires a signed-in session. Responses never include password hashes. The server checks the caller's organization and project membership on each route.

Projects have a name, description, status (`active` or `archived`), organization, and creator. Creating a project adds the creator as a member. Admin and manager can create projects. HR and employee cannot. Admin can list every project in the organization. Everyone else lists only projects they belong to. Archived projects stay in the list.

- `POST /projects` with `{ name, description }`
- `GET /projects`
- `GET /projects/:id` returns the project, its members, and whether the caller can update the project or change members
- `PATCH /projects/:id` with `{ name, description, status }` archives by setting `status` to `archived`
- `POST /projects/:id/members` with `{ userId }`
- `DELETE /projects/:id/members/:userId`

An admin or manager must be a member of the project to add or remove members. The new member must be an active user in the same organization. There is no project-level role.

Tasks belong to one project. Members and admins can list and update them. A non-member who is not an admin receives 403. Ids from another organization are rejected.

- `POST /projects/:id/tasks`
- `GET /projects/:id/tasks` filters: `status`, `assigneeId`, `priority`, and `mine=true`
- `GET /tasks/:id`
- `PATCH /tasks/:id` updates title, description, status (`todo`, `in_progress`, `done`), priority (`low`, `medium`, `high`), assignee, and due date (`YYYY-MM-DD`)
- `POST /tasks/:id/comments` with `{ body }`
- `GET /tasks/:id/comments`
- `GET /tasks/:id/activity`

An archived project rejects new tasks and rejects task edits, including status changes. Status must be `todo`, `in_progress`, or `done`. Activity records task creation, status changes, assignee changes, and priority changes.

## People, leave, and payslips

Employee profiles are separate from sign-in accounts. HR or an admin creates and edits them. A profile has a name, job title, department, start date, a linked user in the same organization, and an optional manager. A user can have one profile. Project membership does not reveal profiles, leave, or payslips. Responses never include password hashes or file paths.

- `POST /employees` and `PATCH /employees/:id` for HR or admin
- `GET /employees` and `GET /employees/:id` — admin and HR see the organization, a manager sees their own profile and direct reports, anyone else sees only their own profile

Leave types are `annual`, `sick`, and `unpaid`. The signed-in person submits for their own profile. Status is `pending`, `approved`, or `rejected`. The profile's manager decides when one is set; otherwise any HR user can decide. An admin can also decide. The record stores the approver, the time, and an optional comment. Balances are not calculated.

- `POST /leave` with `{ type, startDate, endDate, reason }`
- `GET /leave` returns only requests the caller is allowed to see
- `POST /leave/:id/decision` with `{ status, comment }`

Payslips are uploaded PDFs, at most 5 MB, stored outside the repo (`FILE_ROOT`, or `~/worknest-files`). HR or an admin uploads one for an employee. The employee, HR, and admins can download it through the API. Another employee, a manager, and a project member receive 403.

- `POST /employees/:id/payslips` multipart field `file`
- `GET /employees/:id/payslips`
- `GET /payslips/:id/file`
