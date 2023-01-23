'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var got = require('got');
var queries = require('./queries.js');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var got__default = /*#__PURE__*/_interopDefaultLegacy(got);

/**
 * Create a Shopify Storefront GraphQL client for the provided name and token.
 */
const createClient = ({ storeUrl, storefrontToken, timeout }) => got__default['default'].extend({
  prefixUrl: `${storeUrl}/api/2023-01`,
  headers: {
    'X-Shopify-Storefront-Access-Token': storefrontToken
  },
  resolveBodyOnly: true,
  responseType: 'json',
  retry: 2,
  timeout
});

/**
 * Get all paginated data from a query. Will execute multiple requests as
 * needed.
 */
const queryAll = async (client, query, variables) => {
  const items = client.paginate.each('graphql.json', {
    method: 'POST',
    json: { query, variables },
    pagination: {
      backoff: 1000,
      transform: ({ body: { data, errors } }) => {
        if (errors) return []
        return data.data.edges
      },
      paginate: (response, allItems, currentItems) => {
        const { errors, data } = response.body;
        if (errors) throw new Error(errors[ 0 ].message)

        const { pageInfo } = data.data;
        if (!pageInfo.hasNextPage) return false

        const lastItem = currentItems[ currentItems.length - 1 ];
        const newVariables = { ...variables, after: lastItem.cursor };

        return {
          json: { query, variables: newVariables }
        }
      }
    }
  });

  const allNodes = [];
  for await (const { node, typeName } of items) {
    if (typeName !== 'CollectionEdge') {
      allNodes.push(node);
      continue
    }

    // Currently setup for Collection.products field, but can extend this method in future, if needed
    if (!node.products.pageInfo.hasNextPage) {
      allNodes.push(node);
      continue
    }

    const lastProduct = node.products.edges[ node.products.edges.length - 1 ];
    const collectionVariables = { ...variables, handle: node.handle, after: lastProduct.cursor };

    const remainingProducts = await client.paginate.all('graphql.json', {
      method: 'POST',
      json: { query: queries.COLLECTION_QUERY, variables: collectionVariables },
      pagination: {
        backoff: 1000,
        transform: ({ body: { data, errors } }) => {
          if (errors) return []
          return data.collection.products.edges
        },
        paginate: (response, allItems, currentItems) => {
          const { errors, data } = response.body;
          if (errors) throw new Error(errors[ 0 ].message)

          const { pageInfo } = data.collection.products;
          if (!pageInfo.hasNextPage) return false

          const lastItem = currentItems[ currentItems.length - 1 ];
          const newVariables = { ...collectionVariables, after: lastItem.cursor };

          return {
            json: { query: queries.COLLECTION_QUERY, variables: newVariables }
          }
        }
      }
    });

    const edges = [...node.products.edges, ...remainingProducts];
    allNodes.push({ ...node, products: { edges } });
  }

  return allNodes
};

exports.createClient = createClient;
exports.queryAll = queryAll;
