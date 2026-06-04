<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).

```
Smartelec_Backend
├─ .prettierrc
├─ .sixth
│  └─ skills
├─ eslint.config.mjs
├─ nest-cli.json
├─ package-lock.json
├─ package.json
├─ prisma
│  ├─ migrations
│  │  ├─ 20260319155810_upgrade_user_and_chat_tables
│  │  │  └─ migration.sql
│  │  ├─ 20260422083431_init_new_schema
│  │  │  └─ migration.sql
│  │  ├─ 20260422091915_fix_duplicate_role
│  │  │  └─ migration.sql
│  │  └─ migration_lock.toml
│  └─ schema.prisma
├─ README.md
├─ scratch
│  ├─ create-technician.ts
│  └─ query-sessions.ts
├─ src
│  ├─ ai
│  │  ├─ ai.controller.ts
│  │  ├─ ai.module.ts
│  │  └─ ai.service.ts
│  ├─ app.controller.spec.ts
│  ├─ app.controller.ts
│  ├─ app.module.ts
│  ├─ app.service.ts
│  ├─ auth
│  │  ├─ auth.controller.spec.ts
│  │  ├─ auth.controller.ts
│  │  ├─ auth.module.ts
│  │  ├─ auth.service.spec.ts
│  │  ├─ auth.service.ts
│  │  ├─ dto
│  │  │  ├─ login.dto.ts
│  │  │  └─ register.dto.ts
│  │  ├─ guards
│  │  │  └─ jwt-auth.guard.ts
│  │  └─ jwt.strategy.ts
│  ├─ chat-history
│  │  ├─ chat-history.controller.ts
│  │  ├─ chat-history.module.ts
│  │  └─ chat-history.service.ts
│  ├─ chats
│  │  ├─ chat.controller.ts
│  │  ├─ chats.controller.ts
│  │  ├─ chats.gateway.ts
│  │  ├─ chats.module.ts
│  │  ├─ chats.service.ts
│  │  └─ dto
│  │     ├─ create-quote.dto.ts
│  │     └─ send-message.dto.ts
│  ├─ devices
│  │  ├─ devices.controller.ts
│  │  ├─ devices.module.ts
│  │  ├─ devices.service.ts
│  │  ├─ dto
│  │  │  ├─ create-device.dto.ts
│  │  │  └─ update-device.dto.ts
│  │  └─ entities
│  │     └─ device.entity.ts
│  ├─ jobs
│  │  ├─ job-dispatch.processor.ts
│  │  ├─ jobs.module.ts
│  │  └─ jobs.service.ts
│  ├─ main.ts
│  ├─ mechanic-ai
│  │  ├─ mechanic-ai.controller.ts
│  │  ├─ mechanic-ai.module.ts
│  │  └─ mechanic-ai.service.ts
│  ├─ notifications
│  │  ├─ notifications.controller.ts
│  │  ├─ notifications.module.ts
│  │  └─ notifications.service.ts
│  ├─ prisma
│  │  ├─ prisma.module.ts
│  │  ├─ prisma.service.spec.ts
│  │  └─ prisma.service.ts
│  ├─ rag
│  │  ├─ dto
│  │  │  └─ ingest-document.dto.ts
│  │  ├─ rag.controller.ts
│  │  ├─ rag.module.ts
│  │  └─ rag.service.ts
│  ├─ upload
│  │  ├─ upload.controller.ts
│  │  ├─ upload.module.ts
│  │  └─ upload.service.ts
│  └─ users
│     ├─ users.controller.ts
│     ├─ users.module.ts
│     ├─ users.service.spec.ts
│     └─ users.service.ts
├─ test
│  ├─ app.e2e-spec.ts
│  └─ jest-e2e.json
├─ test-rlhf.ts
├─ tsconfig.build.json
├─ tsconfig.build.tsbuildinfo
└─ tsconfig.json

```
```
Smartelec_Backend
├─ .prettierrc
├─ .sixth
│  └─ skills
├─ docs
├─ eslint.config.mjs
├─ nest-cli.json
├─ package-lock.json
├─ package.json
├─ prisma
│  ├─ migrations
│  │  ├─ 20260319155810_upgrade_user_and_chat_tables
│  │  │  └─ migration.sql
│  │  ├─ 20260422083431_init_new_schema
│  │  │  └─ migration.sql
│  │  ├─ 20260422091915_fix_duplicate_role
│  │  │  └─ migration.sql
│  │  └─ migration_lock.toml
│  └─ schema.prisma
├─ README.md
├─ src
│  ├─ admin
│  │  ├─ accounts
│  │  │  ├─ admin-accounts.controller.ts
│  │  │  ├─ admin-accounts.module.ts
│  │  │  ├─ admin-accounts.service.ts
│  │  │  └─ dto
│  │  │     ├─ create-admin-account.dto.ts
│  │  │     └─ update-admin-account.dto.ts
│  │  ├─ admin.module.ts
│  │  ├─ chats
│  │  │  ├─ admin-chats.controller.ts
│  │  │  ├─ admin-chats.module.ts
│  │  │  └─ admin-chats.service.ts
│  │  └─ technicians
│  │     ├─ admin-technicians.controller.ts
│  │     ├─ admin-technicians.module.ts
│  │     └─ admin-technicians.service.ts
│  ├─ ai
│  │  ├─ ai.controller.ts
│  │  ├─ ai.module.ts
│  │  └─ ai.service.ts
│  ├─ app.controller.spec.ts
│  ├─ app.controller.ts
│  ├─ app.module.ts
│  ├─ app.service.ts
│  ├─ auth
│  │  ├─ auth.controller.spec.ts
│  │  ├─ auth.controller.ts
│  │  ├─ auth.module.ts
│  │  ├─ auth.service.spec.ts
│  │  ├─ auth.service.ts
│  │  ├─ dto
│  │  │  ├─ google-login.dto.ts
│  │  │  ├─ login.dto.ts
│  │  │  ├─ register.dto.ts
│  │  │  ├─ set-password.dto.ts
│  │  │  └─ zalo-login.dto.ts
│  │  ├─ guards
│  │  │  └─ jwt-auth.guard.ts
│  │  └─ jwt.strategy.ts
│  ├─ chat-history
│  │  ├─ chat-history.controller.ts
│  │  ├─ chat-history.module.ts
│  │  └─ chat-history.service.ts
│  ├─ chats
│  │  ├─ chat.controller.ts
│  │  ├─ chats.controller.ts
│  │  ├─ chats.gateway.ts
│  │  ├─ chats.module.ts
│  │  ├─ chats.service.ts
│  │  └─ dto
│  │     ├─ create-quote.dto.ts
│  │     └─ send-message.dto.ts
│  ├─ devices
│  │  ├─ devices.controller.ts
│  │  ├─ devices.module.ts
│  │  ├─ devices.service.ts
│  │  ├─ dto
│  │  │  ├─ create-device.dto.ts
│  │  │  └─ update-device.dto.ts
│  │  └─ entities
│  │     └─ device.entity.ts
│  ├─ jobs
│  │  ├─ job-dispatch.processor.ts
│  │  ├─ jobs.module.ts
│  │  └─ jobs.service.ts
│  ├─ main.ts
│  ├─ mechanic-ai
│  │  ├─ mechanic-ai.controller.ts
│  │  ├─ mechanic-ai.module.ts
│  │  └─ mechanic-ai.service.ts
│  ├─ notifications
│  │  ├─ notifications.controller.ts
│  │  ├─ notifications.module.ts
│  │  └─ notifications.service.ts
│  ├─ prisma
│  │  ├─ prisma.module.ts
│  │  ├─ prisma.service.spec.ts
│  │  └─ prisma.service.ts
│  ├─ rag
│  │  ├─ dto
│  │  │  └─ ingest-document.dto.ts
│  │  ├─ rag.controller.ts
│  │  ├─ rag.module.ts
│  │  └─ rag.service.ts
│  ├─ upload
│  │  ├─ upload.controller.ts
│  │  ├─ upload.module.ts
│  │  └─ upload.service.ts
│  └─ users
│     ├─ users.controller.ts
│     ├─ users.module.ts
│     ├─ users.service.spec.ts
│     └─ users.service.ts
├─ test
│  ├─ app.e2e-spec.ts
│  └─ jest-e2e.json
├─ test-rlhf.ts
├─ tsconfig.build.json
├─ tsconfig.build.tsbuildinfo
├─ tsconfig.json
└─ tài liệu zalo.md

```