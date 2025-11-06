# Developer Onboarding - Presentation Slides Outline (30 min)

---

## Slide 1: Title Slide (1 min)
**Developer Onboarding Tutorial**
- Building Features in Rucio WebUI
- Clean Architecture in Practice
- Time: 30 minutes
- Example: List Subscriptions Feature

**Speaker Notes**: Welcome everyone. Today we'll learn how to build features in the Rucio WebUI using Clean Architecture. We'll build a complete feature from scratch - listing subscriptions from the Rucio server.

---

## Slide 2: What We'll Cover (1 min)

**Agenda**:
1. **Architecture Overview** (3 min)
2. **Part 1: Gateway Layer** - Port, Gateway, Endpoint, Tests (8 min)
3. **Part 2: Feature Layer** - UseCase, Controller, Presenter (8 min)
4. **Part 3: API & UI** - API Routes, React Components (6 min)
5. **Part 4: UI Design** - Styling & Components (3 min)
6. **Q&A** (remaining time)

**Speaker Notes**: We'll work through a complete feature implementation. By the end, you'll know how to create secondary output ports, gateways with tests, use cases, and connect them to React components.

---

## Slide 3: Architecture Overview - Layers (2 min)

**Clean Architecture Layers**:

```
┌──────────────────────────────────┐
│   React Components (UI)           │
├──────────────────────────────────┤
│   API Routes (Next.js)            │
├──────────────────────────────────┤
│   Controllers (Infrastructure)    │
├──────────────────────────────────┤
│   Use Cases (Core Business Logic) │
├──────────────────────────────────┤
│   Gateways (Infrastructure)       │
├──────────────────────────────────┤
│   Endpoints (HTTP Layer)          │
├──────────────────────────────────┤
│   Rucio Server (External)         │
└──────────────────────────────────┘
```

**Key Principle**: Dependencies point inward. Core layer defines interfaces, infrastructure implements them.

**Speaker Notes**: Our architecture follows Clean Architecture principles. The core business logic is isolated and infrastructure layers depend on it, not vice versa. This makes testing easier and code more maintainable.

---

## Slide 4: Architecture Overview - Data Flow (1 min)

**Request Flow**:
```
User clicks → React calls API → API Route calls Controller
→ Controller prepares request → UseCase validates & calls Gateway
→ Gateway calls Endpoint → Endpoint fetches from Rucio
→ Data flows back through layers with transformations
```

**Key Transformations**:
- Rucio JSON → DTO → Response Model → View Model → UI

**Speaker Notes**: Data flows through the layers with clear transformations at each boundary. Each layer has its own data structure optimized for its purpose.

---

## Slide 5: PART 1 - Secondary Output Port (1 min)

**File**: `src/lib/core/port/secondary/subscription-gateway-output-port.ts`

```typescript
export default interface SubscriptionGatewayOutputPort {
    /**
     * Lists all subscriptions for a given account
     */
    list(
        rucioAuthToken: string,
        account: string
    ): Promise<ListSubscriptionsDTO>;
}
```

**Key Points**:
- ✅ Interface only (no implementation)
- ✅ Clear method signatures
- ✅ JSDoc comments
- ✅ Located in `core/port/secondary`

**Speaker Notes**: The secondary output port is an interface that defines what operations our gateway must support. It's part of the core layer and contains no implementation details.

---

## Slide 6: PART 1 - Define DTOs (1 min)

**File**: `src/lib/core/dto/subscription-dto.ts`

```typescript
export interface SubscriptionDTO
    extends Subscription, BaseDTO {}

export interface ListSubscriptionsDTO
    extends BaseStreamableDTO {
    // Inherits: status, stream, error
}
```

**Key Points**:
- ✅ DTOs for data transfer between layers
- ✅ Streaming DTOs include `stream` or `error`
- ✅ Located in `core/dto`

**Speaker Notes**: DTOs define the data structures passed between layers. Streaming DTOs have special fields for handling streams or errors.

---

## Slide 7: PART 1 - Implement Gateway (2 min)

**File**: `src/lib/infrastructure/gateway/subscription-gateway/subscription-gateway.ts`

```typescript
@injectable()
export default class SubscriptionGateway
    implements SubscriptionGatewayOutputPort {

    async list(rucioAuthToken: string, account: string) {
        try {
            const endpoint = new ListSubscriptionsEndpoint(
                rucioAuthToken, account
            );
            const errorDTO = await endpoint.fetch();

            if (!errorDTO) {
                return { status: 'success', stream: endpoint };
            }
            return errorDTO;
        } catch (error) {
            return {
                status: 'error',
                errorMessage: error?.toString()
            };
        }
    }
}
```

**Key Points**:
- ✅ `@injectable()` for IoC
- ✅ Implements port interface
- ✅ Delegates to endpoints
- ✅ Consistent error handling

**Speaker Notes**: The gateway implements the port interface and delegates to endpoints. For streaming, we return the endpoint itself wrapped in a success DTO. Notice the decorator for dependency injection.

---

## Slide 8: PART 1 - Create Endpoint (2 min)

**File**: `src/lib/infrastructure/gateway/subscription-gateway/endpoints/list-subscriptions-endpoint.ts`

```typescript
export default class ListSubscriptionsEndpoint
    extends BaseStreamableEndpoint<ListSubscriptionsDTO, SubscriptionDTO> {

    constructor(
        private readonly rucioAuthToken: string,
        private readonly account: string
    ) {
        super(true); // streamAsNDJSON = true
    }

    async initialize(): Promise<void> {
        await super.initialize();
        const rucioHost = await this.envConfigGateway.rucioHost();

        this.request = {
            method: 'GET',
            url: `${rucioHost}/subscriptions/${this.account}`,
            headers: {
                'X-Rucio-Auth-Token': this.rucioAuthToken,
                'Content-Type': 'application/x-json-stream',
            },
        };
        this.initialized = true;
    }

    createDTO(response: Buffer): SubscriptionDTO {
        const data = JSON.parse(JSON.parse(response.toString()));
        return convertToSubscriptionDTO(data, this.account);
    }
}
```

**Key Points**:
- ✅ Extends `BaseStreamableEndpoint`
- ✅ `initialize()` builds HTTP request
- ✅ `createDTO()` transforms each line

**Speaker Notes**: Endpoints handle HTTP communication. The initialize method builds the request. For streaming endpoints, createDTO is called for each line of the NDJSON response.

---

## Slide 9: PART 1 - Gateway Tests (1 min)

**File**: `test/gateway/subscription/subscription-gateway.test.ts`

```typescript
describe('SubscriptionGateway', () => {
    beforeEach(() => {
        fetchMock.doMock();

        const stream = Readable.from([
            JSON.stringify({ id: '1', name: 'Sub1' }),
            JSON.stringify({ id: '2', name: 'Sub2' }),
        ].join('\n'));

        const endpoint: MockEndpoint = {
            url: `${MockRucioServerFactory.RUCIO_HOST}/subscriptions/...`,
            method: 'GET',
            response: { status: 200, body: stream },
        };

        MockRucioServerFactory.createMockRucioServer(true, [endpoint]);
    });

    it('should stream subscriptions', async () => {
        const gateway = appContainer.get(GATEWAYS.SUBSCRIPTION);
        const dto = await gateway.list(token, 'ddmadmin');

        expect(dto.status).toEqual('success');

        const receivedData = [];
        await new Promise((resolve) => {
            dto.stream.on('data', (data) => receivedData.push(data));
            dto.stream.on('end', resolve);
        });

        expect(receivedData.length).toEqual(2);
    });
});
```

**Key Points**:
- ✅ Mock Rucio server
- ✅ Test stream handling
- ✅ Verify data transformation

**Speaker Notes**: Always test gateways with mocked servers. For streaming, we listen to data events and verify we receive all items correctly.

---

## Slide 10: PART 1 - Gateway Layer Complete! (30 sec)

**What We Built**:
- ✅ Secondary Output Port (interface)
- ✅ DTOs (data structures)
- ✅ Gateway (implementation)
- ✅ Endpoint (HTTP layer)
- ✅ Gateway Utils (transformers)
- ✅ Tests (with mocked server)

**Result**: A fully tested gateway that can stream subscriptions from Rucio!

**Speaker Notes**: Great! We've completed the gateway layer. We can now fetch data from Rucio. Next, let's build the feature layer that uses this gateway.

---

## Slide 11: PART 2 - UseCase Models (1 min)

**File**: `src/lib/core/usecase-models/list-subscriptions-usecase-models.ts`

```typescript
export interface ListSubscriptionsRequest {
    account: string;
}

export interface ListSubscriptionsResponse
    extends Subscription, BaseResponseModel {}

export interface ListSubscriptionsError
    extends BaseErrorResponseModel {
    error: 'INVALID_ACCOUNT' | string;
}
```

**Key Points**:
- ✅ Request: input to use case
- ✅ Response: successful output
- ✅ Error: error cases
- ✅ Located in `core/usecase-models`

**Speaker Notes**: UseCase models define the contract for the business logic layer. We have request, response, and error models for type safety.

---

## Slide 12: PART 2 - Create UseCase (2 min)

**File**: `src/lib/core/use-case/list-subscriptions-usecase.ts`

```typescript
@injectable()
class ListSubscriptionsUseCase
    extends BaseSingleEndpointStreamingUseCase<...>
    implements ListSubscriptionsInputPort {

    constructor(
        protected presenter: ListSubscriptionsOutputPort,
        private gateway: SubscriptionGatewayOutputPort
    ) {
        super(presenter);
    }

    validateRequestModel(requestModel) {
        if (!requestModel.account) {
            return {
                status: 'error',
                error: 'INVALID_ACCOUNT',
                message: 'Account is required'
            };
        }
    }

    async makeGatewayRequest(requestModel) {
        return await this.gateway.list(
            requestModel.rucioAuthToken,
            requestModel.account
        );
    }

    processStreamedData(dto: SubscriptionDTO) {
        if (dto.status === 'error') {
            return { status: 'error', data: {...} };
        }
        return { status: 'success', data: { ...dto } };
    }
}
```

**Key Points**:
- ✅ Extends streaming base class
- ✅ Inject gateway and presenter
- ✅ Implement lifecycle: validate → call gateway → process

**Speaker Notes**: The UseCase orchestrates business logic. It validates input, calls the gateway, and processes results. Notice we inject the gateway through the constructor.

---

## Slide 13: PART 2 - Create Controller (1 min)

**File**: `src/lib/infrastructure/controller/list-subscriptions-controller.ts`

```typescript
export type ListSubscriptionsControllerParameters =
    TAuthenticatedControllerParameters & {
        sessionAccount: string;
    };

@injectable()
class ListSubscriptionsController
    extends BaseController<...> {

    constructor(
        @inject(USECASE_FACTORY.LIST_SUBSCRIPTIONS)
        useCaseFactory: (response: Signal) => ListSubscriptionsInputPort
    ) {
        super(useCaseFactory);
    }

    prepareRequestModel(parameters) {
        return {
            rucioAuthToken: parameters.rucioAuthToken,
            account: parameters.sessionAccount,
        };
    }
}
```

**Key Points**:
- ✅ Maps HTTP params to UseCase request
- ✅ Inject use case factory
- ✅ `rucioAuthToken` added automatically

**Speaker Notes**: The controller is the adapter between HTTP and business logic. It transforms HTTP parameters into the request model the UseCase expects.

---

## Slide 14: PART 2 - Create Presenter (1 min)

**File**: `src/lib/infrastructure/presenter/list-subscriptions-presenter.ts`

```typescript
export default class ListSubscriptionsPresenter
    extends BaseStreamingPresenter<...> {

    streamResponseModelToViewModel(responseModel) {
        return {
            ...responseModel,
            replication_rules: JSON.stringify(
                responseModel.replication_rules
            ),
        };
    }

    streamErrorModelToViewModel(error) {
        const viewModel = getEmptySubscriptionViewModel();
        viewModel.message = error.message;
        viewModel.status = 'error';
        return viewModel;
    }

    convertErrorModelToViewModel(errorModel) {
        const viewModel = getEmptySubscriptionViewModel();
        if (errorModel.error === 'INVALID_ACCOUNT') {
            viewModel.message = errorModel.message;
            return { status: 400, viewModel };
        }
        return { status: 500, viewModel };
    }
}
```

**Key Points**:
- ✅ Transform response → view model
- ✅ Transform errors → view model
- ✅ Determine HTTP status codes

**Speaker Notes**: The presenter transforms business models to view models for the UI. It also determines appropriate HTTP status codes for errors.

---

## Slide 15: PART 2 - View Model (1 min)

**File**: `src/lib/infrastructure/data/view-model/subscriptions.ts`

```typescript
export interface SubscriptionViewModel
    extends BaseViewModel,
    Omit<Subscription, 'replication_rules'> {
    replication_rules: string; // Stringified for JSON
}

export function getEmptySubscriptionViewModel(): SubscriptionViewModel {
    return {
        status: 'error',
        account: '',
        id: '',
        name: '',
        // ... default values
    };
}
```

**Key Points**:
- ✅ Data shape for UI consumption
- ✅ May differ from domain model
- ✅ Helper for empty/error state

**Speaker Notes**: View models are optimized for UI consumption and JSON serialization. Notice we stringify complex fields like replication_rules.

---

## Slide 16: PART 2 - Register Feature in IoC (1 min)

**File**: `src/lib/infrastructure/ioc/features/list-subscriptions-feature.ts`

```typescript
export default class ListSubscriptionsFeature
    extends BaseStreamableFeature<...> {

    constructor(appContainer: Container) {
        const gateway = appContainer.get(GATEWAYS.SUBSCRIPTION);

        const symbols = {
            CONTROLLER: CONTROLLERS.LIST_SUBSCRIPTIONS,
            USECASE_FACTORY: USECASE_FACTORY.LIST_SUBSCRIPTIONS,
            INPUT_PORT: INPUT_PORT.LIST_SUBSCRIPTIONS,
        };

        super(
            'ListSubscriptions',
            ListSubscriptionsController,
            ListSubscriptionsUseCase,
            [gateway],              // UseCase constructor args
            ListSubscriptionsPresenter,
            false,                  // passSessionToPresenter
            symbols,
        );
    }
}
```

**Then in `container-config.ts`**:
```typescript
loadFeaturesSync(appContainer, [
    new ListSubscriptionsFeature(appContainer),
]);
```

**Key Points**:
- ✅ Wire all components together
- ✅ Register in container

**Speaker Notes**: The Feature class wires everything together using dependency injection. We register it in the container config and it handles all the IoC plumbing.

---

## Slide 17: PART 2 - Feature Layer Complete! (30 sec)

**What We Built**:
- ✅ UseCase Models (request/response/error)
- ✅ UseCase (business logic)
- ✅ Controller (HTTP → UseCase)
- ✅ Presenter (UseCase → UI)
- ✅ View Model (UI data shape)
- ✅ Feature Registration (IoC)

**Result**: A complete feature with business logic, ready to be exposed via API!

**Speaker Notes**: Excellent! We've built the entire feature layer. Now we just need to expose it through an API route and build the UI.

---

## Slide 18: PART 3 - Create API Route (2 min)

**File**: `src/app/api/feature/list-subscription/route.ts`

```typescript
import 'reflect-metadata'; // Required!

export async function GET(request: NextRequest) {
    try {
        // 1. Validate session
        const sessionUser = await getSessionUser();
        if (!sessionUser) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // 2. Parse params (optional)
        const params = parseQueryParams(request);

        // 3. Get controller from IoC
        const controller = appContainer.get(
            CONTROLLERS.LIST_SUBSCRIPTIONS
        );

        // 4. Execute controller
        return executeAuthenticatedController(
            controller,
            { sessionAccount: sessionUser.rucioAccount },
            true // isStreaming = true
        );
    } catch (error) {
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
```

**Key Points**:
- ✅ Import `'reflect-metadata'` first!
- ✅ Validate session
- ✅ Get controller from IoC
- ✅ Set `isStreaming: true` for streams

**Speaker Notes**: API routes are straightforward. Import reflect-metadata, validate session, get the controller, and execute it. The framework handles auth token injection.

---

## Slide 19: PART 3 - Create React Component (2 min)

**File**: `src/component-library/pages/Subscriptions/list/ListSubscription.tsx`

```typescript
export const ListSubscription = (props) => {
    // Streaming hook
    const { gridApi, onGridReady, streamingHook, startStreaming } =
        useTableStreaming<SubscriptionViewModel>(props.initialData);

    const [startedStreaming, setStartedStreaming] = useState(false);

    // Start streaming when grid ready
    useEffect(() => {
        if (!props.initialData && gridApi && !startedStreaming) {
            startStreaming('/api/feature/list-subscription');
            setStartedStreaming(true);
        }
    }, [gridApi, startStreaming, startedStreaming]);

    // Get user account
    const { data: siteHeader, error, isFetching } = useQuery({
        queryKey: ['subscription-account'],
        queryFn: async () => {
            const res = await fetch('/api/feature/get-site-header');
            return res.json();
        },
    });

    if (isFetching) return <div>Loading...</div>;
    if (error) return <div>Error</div>;

    return (
        <div className="flex flex-col space-y-3 w-full">
            <Heading text="Subscriptions" />
            <ListSubscriptionTable
                streamingHook={streamingHook}
                onGridReady={onGridReady}
            />
        </div>
    );
};
```

**Key Points**:
- ✅ `useTableStreaming` for NDJSON data
- ✅ `useQuery` for regular API calls
- ✅ Handle loading/error states

**Speaker Notes**: React components use hooks to call our API routes. The useTableStreaming hook handles NDJSON streaming automatically.

---

## Slide 20: PART 3 - Create Table Component (1 min)

**File**: `src/component-library/pages/Subscriptions/list/ListSubscriptionTable.tsx`

```typescript
export const ListSubscriptionTable = (props) => {
    const tableRef = useRef(null);

    const [columnDefs] = useState([
        {
            headerName: 'Name',
            field: 'name',
            flex: 5,
            minWidth: 300,
            cellRenderer: ClickableName,
            filter: true,
        },
        {
            headerName: 'State',
            field: 'state',
            flex: 2,
        },
        // ... more columns
    ]);

    return (
        <StreamedTable
            columnDefs={columnDefs}
            tableRef={tableRef}
            {...props}
        />
    );
};
```

**Key Points**:
- ✅ Define column definitions
- ✅ Use `StreamedTable` component
- ✅ Custom cell renderers for links

**Speaker Notes**: The table component is simple - define columns and use our StreamedTable component which handles the streaming data automatically.

---

## Slide 21: PART 3 - API & UI Complete! (30 sec)

**What We Built**:
- ✅ API Route (HTTP endpoint)
- ✅ React Page Component (with streaming hook)
- ✅ Table Component (AG Grid integration)

**Result**: A fully functional feature from backend to frontend!

**Demo Time**: Let's see it in action!

**Speaker Notes**: We're done! Let's quickly demo the feature working. You can see subscriptions streaming in real-time into the table.

---

## Slide 22: PART 4 - Styling Patterns (1 min)

**Tailwind CSS**:
```typescript
// Layout
<div className="flex flex-col space-y-3 w-full grow">

// Card
<div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">

// Button
<button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
```

**Component Library**:
```typescript
// Atoms
<Heading text="Title" />
<InfoField>Loading...</InfoField>
<WarningField>Error!</WarningField>

// Features
<StreamedTable {...props} />
<RuleStateBadge value={state} />
<ClickableCell href="/path">Link</ClickableCell>
```

**Key Points**:
- ✅ Tailwind for utilities
- ✅ Reusable component library
- ✅ Dark mode support

**Speaker Notes**: We use Tailwind CSS for styling with a component library for common patterns. All components support dark mode out of the box.

---

## Slide 23: PART 4 - Component Library Structure (1 min)

```
component-library/
├── atoms/              # Basic UI elements
│   ├── misc/
│   │   └── Heading
│   └── ...
├── features/           # Complex reusable components
│   ├── table/
│   │   └── StreamedTable
│   ├── fields/
│   │   ├── InfoField
│   │   └── WarningField
│   └── badges/
│       └── RuleStateBadge
└── pages/              # Page-level components
    ├── Subscriptions/
    ├── Rule/
    └── ...
```

**Atomic Design**:
- **Atoms**: Basic building blocks (buttons, headings)
- **Features**: Reusable compositions (tables, forms)
- **Pages**: Full page layouts

**Speaker Notes**: Our component library follows atomic design principles. Start with atoms, compose them into features, and use features in pages.

---

## Slide 24: PART 4 - UI Design Complete! (30 sec)

**What We Covered**:
- ✅ Tailwind CSS patterns
- ✅ Component library structure
- ✅ Reusable atoms & features
- ✅ Dark mode support

**Tip**: Always check existing components before creating new ones!

**Speaker Notes**: That's a quick overview of our UI patterns. Always look at existing pages for examples and reuse components where possible.

---

## Slide 25: Complete Feature Checklist (1 min)

**When creating a new feature:**

### Core Layer
- [ ] Entity types (if new)
- [ ] DTOs
- [ ] Secondary output port (gateway interface)
- [ ] Primary ports (input/output)
- [ ] UseCase models
- [ ] UseCase implementation

### Infrastructure
- [ ] Gateway implementation
- [ ] Endpoint(s)
- [ ] Gateway utils (transformers)
- [ ] Controller
- [ ] Presenter
- [ ] View model
- [ ] Feature registration
- [ ] IoC symbols

### API & UI
- [ ] API route
- [ ] React page component
- [ ] Table/display component

### Tests
- [ ] Gateway tests
- [ ] Mock endpoints

**Speaker Notes**: Use this checklist when building features to ensure you don't miss any components. It's also a good code review checklist.

---

## Slide 26: Streaming vs Non-Streaming (1 min)

| Aspect | Streaming | Non-Streaming |
|--------|-----------|---------------|
| **Use Case** | `BaseSingleEndpointStreamingUseCase` | `BaseSingleEndpointUseCase` |
| **Endpoint** | `BaseStreamableEndpoint` | `BaseEndpoint` |
| **Presenter** | `BaseStreamingPresenter` | `BasePresenter` |
| **Response** | NDJSON (one per line) | Single JSON |
| **API Flag** | `isStreaming: true` | `isStreaming: false` |
| **React Hook** | `useTableStreaming` | `useQuery` |
| **Best For** | Large datasets | Single records |

**When to stream**:
- ✅ Lists of items (100+)
- ✅ Real-time updates
- ❌ Single record fetches
- ❌ Small datasets (<50 items)

**Speaker Notes**: Choose streaming for large datasets. For single records or small lists, use the non-streaming approach which is simpler.

---

## Slide 27: Common Pitfalls (1 min)

**Top 5 Mistakes**:

1. ❌ **Forgetting `'reflect-metadata'`** in API routes
   - → Inversify dependency injection fails

2. ❌ **Missing `@injectable()` decorator**
   - → IoC container can't instantiate class

3. ❌ **Not registering feature** in `container-config.ts`
   - → 404 errors, controller not found

4. ❌ **Wrong streaming flag** in API route
   - → Response not chunked properly

5. ❌ **Not handling errors in streams**
   - → Errors appear as data items, crash UI

**Pro Tip**: Look at existing implementations when stuck!

**Speaker Notes**: These are the most common mistakes. If something isn't working, check these first. Always look at similar features for reference.

---

## Slide 28: Testing Strategy (1 min)

**Gateway Tests** (Priority: HIGH):
```typescript
✅ Mock Rucio server with MockRucioServerFactory
✅ Test successful responses
✅ Test error responses (404, 500)
✅ Test stream handling
✅ Verify data transformation
```

**UseCase Tests** (Priority: MEDIUM):
```typescript
✅ Mock gateway
✅ Test validation logic
✅ Test business logic
✅ Test error handling
```

**Integration Tests** (Priority: LOW):
```typescript
✅ Test full flow end-to-end
✅ Test with real API routes
```

**Start with gateway tests** - they catch the most issues!

**Speaker Notes**: Always start with gateway tests. They're the most important as they verify your integration with the Rucio API and data transformation logic.

---

## Slide 29: Key Takeaways (1 min)

**Clean Architecture Benefits**:
- ✅ **Testable**: Mock external dependencies easily
- ✅ **Maintainable**: Clear separation of concerns
- ✅ **Scalable**: Add features without breaking existing code
- ✅ **Understandable**: Consistent patterns across codebase

**Development Workflow**:
1. **Gateway First**: Build and test data access layer
2. **Feature Layer**: Add business logic and transformations
3. **API & UI**: Expose and display the data
4. **Iterate**: Refine based on requirements

**Next Steps**:
- 📚 Read the full tutorial document
- 🔖 Use the quick reference cheat sheet
- 💻 Try building a feature on your own
- 🤝 Ask for code reviews

**Speaker Notes**: Clean Architecture might seem complex at first, but it pays off as the codebase grows. Follow the patterns, and it becomes second nature.

---

## Slide 30: Resources & Help (1 min)

**Documentation**:
- 📄 `DEVELOPER_ONBOARDING_TUTORIAL.md` - Full tutorial with code examples
- 📋 `QUICK_REFERENCE_CHEAT_SHEET.md` - Quick lookup during development
- 📊 `PRESENTATION_SLIDES_OUTLINE.md` - This presentation

**Example Implementations**:
- 📁 `src/lib/infrastructure/gateway/subscription-gateway/` - Full gateway example
- 📁 `src/lib/core/use-case/list-subscriptions-usecase.ts` - Streaming use case
- 📁 `src/component-library/pages/Subscriptions/` - React components
- 📁 `test/gateway/subscription/` - Gateway tests

**Where to Get Help**:
- 👥 Ask the team on Slack
- 🔍 Search existing implementations
- 📝 Check Clean Architecture documentation
- 🐛 Raise issues in the repo

**Speaker Notes**: Use these resources as you start building features. Don't hesitate to ask questions - we're here to help!

---

## Slide 31: Q&A (Remaining Time)

**Questions?**

**Common Questions**:
- How do I add a new endpoint to an existing gateway?
- When should I create a new gateway vs. adding to existing?
- How do I handle pagination in streaming responses?
- What if I need multiple gateways in one UseCase?
- How do I add custom validation logic?

**Let's discuss!**

**Speaker Notes**: Open the floor for questions. If there are common questions, address them. Point to specific examples in the codebase that answer the questions.

---

## Slide 32: Thank You! (30 sec)

**You're Ready to Build!**

**Remember**:
1. Follow the patterns
2. Test your gateways
3. Look at existing examples
4. Ask for code reviews
5. Have fun coding!

**Let's build great features together! 🚀**

---

## PRESENTER NOTES - Timing Guide

**Total: 30 minutes**

- **Introduction & Architecture** (Slides 1-4): 5 minutes
- **Part 1: Gateway Layer** (Slides 5-10): 8 minutes
- **Part 2: Feature Layer** (Slides 11-17): 8 minutes
- **Part 3: API & UI** (Slides 18-21): 5 minutes
- **Part 4: Design** (Slides 22-24): 3 minutes
- **Wrap-up** (Slides 25-30): 4 minutes
- **Q&A** (Slides 31-32): Remaining time

**Tips for Presenter**:
- Keep slides moving - don't dwell too long on code
- Have the full tutorial open for detailed questions
- Demo the working feature if time permits
- Encourage questions throughout, not just at the end
- Share the resources at the beginning so people can follow along

---

## DEMO SCRIPT (Optional - if time permits)

**Live Demo** (3-5 minutes):

1. **Show the API Route**:
   - Open `src/app/api/feature/list-subscription/route.ts`
   - Point out key parts: session validation, controller execution

2. **Show the React Component**:
   - Open `ListSubscription.tsx`
   - Show the streaming hook and how it starts

3. **Run the Application**:
   - Navigate to subscriptions page
   - Show data streaming in real-time
   - Open browser dev tools to show NDJSON response
   - Filter/sort table to show it's interactive

4. **Show the Tests**:
   - Run `npm test subscription-gateway`
   - Show tests passing

**Demo Tips**:
- Have everything pre-loaded and ready
- Use a test environment with known data
- If demo fails, have screenshots as backup
- Keep it brief - focus on the end result

---

**END OF PRESENTATION**
