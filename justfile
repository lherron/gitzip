# gitzip CLI

# Type check the project
check:
    bun run --bun tsc --noEmit

# Build (currently just type checks)
build: check

# Clean, install deps, build, and link for global CLI access
install:
    rm -rf node_modules
    bun install
    just build
    bun link
