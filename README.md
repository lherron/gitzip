# gitzip

CLI tool to download a GitHub repository as a zip file (without git history).

## Install

```bash
bun install
bun link
```

## Usage

```bash
gitzip <repo|user/repo>[@branch][,<repo>...]
gitzip -f <output> <repo|user/repo>[,<repo>...]
```

## Examples

```bash
gitzip octocat/hello             # Creates hello.zip
gitzip -f out.zip myrepo         # Creates out.zip
gitzip user/repo@develop         # Creates repo.zip from develop branch
gitzip foo,bar,baz               # Creates foo-bundle.zip with foo/, bar/, baz/ at top level
```

## Configuration

Set `GITZIP_DEFAULT_USER` in a `.env` file to use shorthand:

```bash
GITZIP_DEFAULT_USER=myusername
```

Then just run `gitzip myrepo` instead of `gitzip myusername/myrepo`.

## License

MIT
