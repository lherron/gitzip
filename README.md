# gitzip

CLI tool to download a GitHub repository as a zip file (without git history).

## Install

```bash
bun install
bun link
```

## Usage

```bash
gitzip <repo|user/repo>
gitzip -f <output> <repo|user/repo>
```

## Examples

```bash
gitzip octocat/hello       # Creates hello.zip
gitzip -f out.zip myrepo   # Creates out.zip
```

## Configuration

Set `GITZIP_DEFAULT_USER` in a `.env` file to use shorthand:

```bash
GITZIP_DEFAULT_USER=myusername
```

Then just run `gitzip myrepo` instead of `gitzip myusername/myrepo`.

## License

MIT
