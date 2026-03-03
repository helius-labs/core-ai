# Contribution Guide

Welcome to the Helius MCP Server! Thank you for considering to contribute; we value your input and want to make it as easy as possible for you to help. Here's how you can help make the MCP server better. Before starting, please read this guide carefully to ensure your contributions align with our standards.

## Style Guide

To maintain high standards of quality, readability, and performance, code should adhere to the following principles:

- **File Naming**: Use `camelCase` or `kebab-case`, consistent with the rest of the codebase.
- **Type Safety**: We use TypeScript — ensure all new code is strongly typed.
- **Tool Registration**: Each tool file exports tool definitions registered in `src/tools/index.ts`. Follow the existing one-file-per-tool-group pattern.
- **SDK vs Raw Fetch**: Use `getHeliusClient()` for SDK methods, `rpcRequest()` for standard Solana RPC, `dasRequest()` for DAS API, and `restRequest()` for REST endpoints. See `src/utils/helius.ts`.
- **Async Handling**: Use async/await for asynchronous operations, wrapped in try/catch blocks.
- **Error Handling**: Handle errors robustly, propagating meaningful messages with relevant error codes from both Helius and Solana.
- **Documentation**: Update documentation if your changes affect how the MCP server is used.
- **Testing**: Add or update tests for any new or modified functionality. Run the full test suite before submitting.

## Pull Requests

Pull Requests are the best way to propose changes. We actively welcome all contributions! To contribute:

- Fork the repository and create your branch from main
- Install all project dependencies using `pnpm`

  ```bash
  # Install pnpm if you don't have it (requires Node.js)
  npm install -g pnpm

  # Install project dependencies
  cd helius-mcp
  pnpm install
  ```

- Make your changes in a clearly scoped branch (e.g., `feat/my-feature`, `fix/bug-description`)
- Add or update tests for new functionality
- Ensure all checks pass:

  ```bash
  pnpm build
  pnpm test
  ```

- Open a pull request with a clear description and reference any related issues

### Good Pull Request Titles

- `fix(mcp): Correct pagination in getTransactionHistory`
- `feat(mcp): Add support for token metadata queries`
- `docs(mcp): Update webhook tool descriptions`

### Avoid Titles Like

- `fix #1234`
- `update code`
- `misc changes`

### Related Issues

If your pull request addresses an open issue, please mention it in the description (e.g., `Closes #1234`).

## Changelog

This project maintains a changelog using [auto-changelog](https://github.com/CookPete/auto-changelog). You do **not** need to update `CHANGELOG.md` manually — it is regenerated automatically during the release process.

### How it works

1. A maintainer tags a release: `git tag helius-mcp@X.Y.Z && git push origin helius-mcp@X.Y.Z`
2. The `mcp-release.yml` workflow regenerates the changelog from merged PRs, opens a review PR, and creates a draft GitHub Release
3. After the changelog PR is reviewed and merged, the maintainer publishes the draft release
4. The `mcp-publish.yml` workflow publishes the package to npm

Your PR title and description are what appear in the changelog, so write them clearly.

## License

By contributing, you agree that your contributions will be licensed under its MIT License. Thus, when you submit code changes, your submissions are understood to be under the [following license](https://github.com/helius-labs/core-ai/blob/main/helius-mcp/LICENSE).

## Thank You!

We deeply appreciate your effort in making the Helius MCP Server better. Your contributions help power better tools for everyone in the Solana ecosystem!
