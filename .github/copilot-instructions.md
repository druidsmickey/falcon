# Angular Games Project - AI Coding Guidelines

## Architecture Overview
This is an Angular 14.2.7 application with TypeScript strict mode enabled. The project follows standard Angular CLI structure with routing configured but currently contains only the default welcome template.

## Key Project Patterns

### Component Structure
- All components follow the pattern: `*.component.{ts,html,css,spec.ts}`
- Components use the `app-` prefix (configured in `angular.json`)
- Template and style files are separate (not inline)
- Example: `AppComponent` in `src/app/app.component.ts` with external template/styles

### Testing Patterns
- Tests use Jasmine + Karma with Chrome launcher
- Component tests require `RouterTestingModule` import for routing-enabled components
- Coverage reports generated to `./coverage/games/` directory
- Test files follow `*.spec.ts` naming convention

### TypeScript Configuration
- Strict mode enabled with additional strict options:
  - `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`
  - `strictInjectionParameters`, `strictInputAccessModifiers`, `strictTemplates`
- Target: ES2020 with decorators enabled
- Base URL set to `./` for clean imports

## Development Workflows

### Building & Serving
- **Development**: `npm start` → serves on `http://localhost:4200/` with hot reload
- **Production build**: `npm run build` → outputs to `dist/games/`
- **Watch mode**: `npm run watch` → continuous development builds
- **Testing**: `npm test` → Karma server on `http://localhost:9876/`

### VS Code Integration
- Pre-configured launch configurations for debugging:
  - "ng serve": Chrome debugging with automatic server startup
  - "ng test": Chrome test debugging with automatic Karma startup
- Tasks configured for npm scripts with proper background process handling
- Angular Language Service extension recommended

### Environment Management
- Development: `src/environments/environment.ts` (production: false)
- Production: `src/environments/environment.prod.ts` (production: true)
- File replacement handled automatically by Angular CLI during builds

## Project Conventions

### Module Organization
- Single root module (`AppModule`) with routing module separation
- Routing configured in `app-routing.module.ts` (currently empty routes array)
- Standard Angular service registration pattern in module providers

### Styling Approach
- Global styles in `src/styles.css`
- Component-specific styles as separate `.css` files
- No CSS preprocessor currently configured

### Bundle Optimization
- Production builds have strict bundle size limits:
  - Initial bundle: 500kb warning, 1mb error
  - Component styles: 2kb warning, 4kb error
- Source maps enabled in development builds

## Code Generation
Use Angular CLI generators with project prefix:
- `ng generate component feature-name` (creates `app-feature-name` selector)
- Components auto-declared in the nearest module
- Follow existing file structure patterns in `src/app/`

## Testing Strategy
- Unit tests for all components with basic creation and property tests
- Use `TestBed.configureTestingModule()` pattern for component testing
- Import required testing modules (e.g., `RouterTestingModule`)
- Test title property and basic rendering in component specs

## Dependency Management & Common Issues

### Deprecation Warnings
- Angular 14.2.7 projects commonly show npm deprecation warnings for Babel plugins and other transitive dependencies
- These warnings are from nested dependencies and don't affect functionality
- Common deprecated packages: `inflight`, `rimraf`, `glob` (older versions), various `@babel/plugin-proposal-*` packages
- Consider these options:
  - **Ignore**: Warnings don't break functionality; continue development
  - **Suppress**: Use `npm install --silent` to reduce noise during development
  - **Upgrade**: Consider migrating to Angular 15+ for updated dependency tree

### PowerShell Execution Policy (Windows)
- If npm commands fail with "execution policy" errors, run PowerShell as Administrator:
  ```powershell
  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
  ```
- Alternative: Use `node_modules\.bin\ng` instead of global `ng` commands

### Node.js Compatibility
- Project tested with Node.js 22.x
- Angular 14 supports Node.js 14.x - 18.x officially; newer versions work but may show warnings

### Common TypeScript Issues
- **@types/node version conflict**: If you see TypeScript errors about `Symbol.dispose` or `Symbol.asyncDispose`, downgrade @types/node:
  ```bash
  npm install --save-dev @types/node@18.15.13
  ```
- This resolves compatibility issues between newer Node.js type definitions and TypeScript 4.7.4