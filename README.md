# @bever/sdk

The JavaScript SDK for [Bever](https://bever.dev): read Bever semantic models and call the Bever HTTP API from browsers and Node.js. The web app that `bever new` creates is built on it.

```sh
npm install @bever/sdk
```

## Read a model

```ts
import { createBeverApp, parseBeverModel } from '@bever/sdk'

const app = createBeverApp(parseBeverModel(modelJson))
const order = app.requireEntity('Order')

order.routeName                       // "orders"
order.presentation.pluralLabel        // "Orders"
order.presentation.listing            // [{ field, label }, ...] in display order
```

`createBeverApp` validates the model (semantic model `0.10`) and resolves presentation defaults: readable labels, field projections, editing modes, action placements, and the picker of each relationship.

## Call the API

```ts
import { BeverHttpError, createBeverClient } from '@bever/sdk'

const client = createBeverClient({ baseUrl: 'https://orders.example.com', model })

const orders = await client.list('orders')
await client.patch('orders', orders[0].id, { status: 'Shipped' })

try {
  await client.create('customers', { name: 'Northwind', email: 'nobody' })
} catch (error) {
  if (error instanceof BeverHttpError) console.log(error.status, error.body)
}
```

The client sends cookies, adds the antiforgery token to changes, and offers `login`, `register`, `logout`, and `getSession` when the model declares them.

Full reference: [bever.dev/reference/sdk](https://bever.dev/reference/sdk).

## Develop

```sh
npm install
npm test
```

`test/fixtures` holds semantic model fixtures shared with the compiler's contract tests in [bever](https://github.com/bever-team/bever); update them together. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Licensed under the [Apache License 2.0](LICENSE). "Bever" and the Bever logo are trademarks; see [TRADEMARKS.md](https://github.com/bever-team/bever/blob/main/TRADEMARKS.md).
