# gitzip CLI

# Type check the project
check:
    bun run --bun tsc --noEmit

# Build (currently just type checks)
build: check

# Link to ~/.bun/bin for global CLI access
install:
    bun link
