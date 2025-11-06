# Quick Reference Cheat Sheet

**Rucio WebUI - Clean Architecture Patterns**

---

## 📁 Directory Structure

```
src/lib/
├── core/                              # Business Logic (Domain Layer)
│   ├── entity/                        # Domain entities (Rucio types)
│   ├── dto/                          # Data Transfer Objects
│   ├── port/
│   │   ├── primary/                  # UseCase interfaces (input/output)
│   │   └── secondary/                # Gateway interfaces (output ports)
│   ├── usecase-models/               # Request/Response/Error models
│   └── use-case/                     # UseCase implementations
│
├── infrastructure/                    # Framework & External Services
│   ├── gateway/                      # Gateway implementations
│   │   └── */endpoints/              # HTTP endpoints
│   ├── controller/                   # HTTP → UseCase mapping
│   ├── presenter/                    # Response → ViewModel transformation
│   ├── data/view-model/              # UI-specific data models
│   └── ioc/                          # Dependency Injection
│       └── features/                 # Feature registrations
│
└── sdk/                              # Base classes & utilities

src/app/api/feature/                   # Next.js API routes

src/component-library/                 # React UI components
├── pages/                            # Page components
├── features/                         # Feature components
└── atoms/                            # Basic UI elements

test/gateway/                         # Gateway tests
```

---

## 🔄 Architecture Flow

```
┌───────────────┐
│ React Page    │ fetch('/api/feature/...')
└───────┬───────┘
        ↓
┌───────────────┐
│ API Route     │ controller.execute()
└───────┬───────┘
        ↓
┌───────────────┐
│ Controller    │ prepareRequestModel()
└───────┬───────┘
        ↓
┌───────────────┐
│ UseCase       │ validate → gateway → process → present
└───────┬───────┘
        ↓
┌───────────────┐
│ Gateway       │ endpoint.fetch()
└───────┬───────┘
        ↓
┌───────────────┐
│ Endpoint      │ HTTP request to Rucio
└───────────────┘
```

---

## 📝 File Naming Conventions

| Component | Filename Pattern | Example |
|-----------|-----------------|---------|
| **Port** | `*-gateway-output-port.ts` | `subscription-gateway-output-port.ts` |
| **Gateway** | `*-gateway.ts` | `subscription-gateway.ts` |
| **Endpoint** | `*-endpoint.ts` | `list-subscriptions-endpoint.ts` |
| **Gateway Utils** | `*-gateway-utils.ts` | `subscription-gateway-utils.ts` |
| **DTO** | `*-dto.ts` | `subscription-dto.ts` |
| **UseCase Models** | `*-usecase-models.ts` | `list-subscriptions-usecase-models.ts` |
| **UseCase** | `*-usecase.ts` | `list-subscriptions-usecase.ts` |
| **Primary Port** | `*-port.ts` | `list-subscriptions-port.ts` |
| **Controller** | `*-controller.ts` | `list-subscriptions-controller.ts` |
| **Presenter** | `*-presenter.ts` | `list-subscriptions-presenter.ts` |
| **View Model** | `*.ts` (in view-model/) | `subscriptions.ts` |
| **Feature** | `*-feature.ts` | `list-subscriptions-feature.ts` |
| **API Route** | `route.ts` (in feature dir) | `list-subscription/route.ts` |
| **Test** | `*-gateway.test.ts` | `subscription-gateway.test.ts` |

---

## 🔧 Code Templates

### 1. Secondary Output Port (Gateway Interface)

```typescript
// src/lib/core/port/secondary/my-feature-gateway-output-port.ts
export default interface MyFeatureGatewayOutputPort {
    list(rucioAuthToken: string, param: string): Promise<ListMyFeatureDTO>;
    get(rucioAuthToken: string, id: string): Promise<MyFeatureDTO>;
}
```

---

### 2. DTO

```typescript
// src/lib/core/dto/my-feature-dto.ts
import { BaseDTO, BaseStreamableDTO } from '@/lib/sdk/dto';
import { MyFeature } from '../entity/rucio';

export interface MyFeatureDTO extends MyFeature, BaseDTO {}

export interface ListMyFeatureDTO extends BaseStreamableDTO {
    // Inherits: status, stream, error, errorMessage, errorCode
}
```

---

### 3. Gateway Implementation

```typescript
// src/lib/infrastructure/gateway/my-feature-gateway/my-feature-gateway.ts
import { injectable } from 'inversify';
import MyFeatureGatewayOutputPort from '@/lib/core/port/secondary/my-feature-gateway-output-port';

@injectable()
export default class MyFeatureGateway implements MyFeatureGatewayOutputPort {
    async list(rucioAuthToken: string, param: string): Promise<ListMyFeatureDTO> {
        try {
            const endpoint = new ListMyFeatureEndpoint(rucioAuthToken, param);
            const errorDTO = await endpoint.fetch();

            if (!errorDTO) {
                return { status: 'success', stream: endpoint };
            }
            return errorDTO;
        } catch (error) {
            return {
                status: 'error',
                errorType: 'gateway_endpoint_error',
                errorMessage: error?.toString(),
            };
        }
    }
}
```

---

### 4. Streaming Endpoint

```typescript
// src/lib/infrastructure/gateway/my-feature-gateway/endpoints/list-my-feature-endpoint.ts
import { BaseStreamableEndpoint } from '@/lib/sdk/gateway-endpoints';
import { Response } from 'node-fetch';

export default class ListMyFeatureEndpoint extends BaseStreamableEndpoint<
    ListMyFeatureDTO,
    MyFeatureDTO
> {
    constructor(private readonly rucioAuthToken: string, private readonly param: string) {
        super(true); // streamAsNDJSON = true
    }

    async initialize(): Promise<void> {
        await super.initialize();
        const rucioHost = await this.envConfigGateway.rucioHost();
        const endpoint = `${rucioHost}/my-feature/${this.param}`;

        this.request = {
            method: 'GET',
            url: endpoint,
            headers: {
                'X-Rucio-Auth-Token': this.rucioAuthToken,
                'Content-Type': 'application/x-json-stream',
            },
        };
        this.initialized = true;
    }

    async reportErrors(statusCode: number, response: Response): Promise<ListMyFeatureDTO | undefined> {
        switch (statusCode) {
            case 404:
                return {
                    status: 'error',
                    error: { errorMessage: 'Not found', errorCode: 404 },
                    stream: null,
                };
            default:
                return {
                    status: 'error',
                    error: { errorMessage: 'Unknown error', errorCode: statusCode },
                    stream: null,
                };
        }
    }

    createDTO(response: Buffer): MyFeatureDTO {
        const data = JSON.parse(JSON.parse(response.toString()));
        return convertToMyFeatureDTO(data);
    }
}
```

---

### 5. UseCase Models

```typescript
// src/lib/core/usecase-models/list-my-feature-usecase-models.ts
import { BaseResponseModel, BaseErrorResponseModel } from '@/lib/sdk/usecase-models';

export interface ListMyFeatureRequest {
    param: string;
}

export interface ListMyFeatureResponse extends MyFeature, BaseResponseModel {}

export interface ListMyFeatureError extends BaseErrorResponseModel {
    error: string;
}
```

---

### 6. UseCase (Streaming)

```typescript
// src/lib/core/use-case/list-my-feature-usecase.ts
import { BaseSingleEndpointStreamingUseCase } from '@/lib/sdk/usecase';
import { injectable } from 'inversify';

@injectable()
class ListMyFeatureUseCase
    extends BaseSingleEndpointStreamingUseCase<
        ListMyFeatureRequest,
        ListMyFeatureResponse,
        ListMyFeatureError,
        ListMyFeatureDTO,
        MyFeatureDTO,
        MyFeatureViewModel
    >
    implements ListMyFeatureInputPort
{
    constructor(
        protected presenter: ListMyFeatureOutputPort,
        private myFeatureGateway: MyFeatureGatewayOutputPort
    ) {
        super(presenter);
    }

    validateRequestModel(requestModel: AuthenticatedRequestModel<ListMyFeatureRequest>): ListMyFeatureError | undefined {
        if (!requestModel.param) {
            return { status: 'error', error: 'INVALID_PARAM', message: 'Param is required' };
        }
    }

    async intializeRequest(request: AuthenticatedRequestModel<ListMyFeatureRequest>): Promise<ListMyFeatureError | undefined> {
        return undefined;
    }

    async makeGatewayRequest(requestModel: AuthenticatedRequestModel<ListMyFeatureRequest>): Promise<ListMyFeatureDTO> {
        return await this.myFeatureGateway.list(requestModel.rucioAuthToken, requestModel.param);
    }

    handleGatewayError(error: ListMyFeatureDTO): ListMyFeatureError {
        return {
            status: 'error',
            error: 'Gateway Error',
            message: error.errorMessage || 'Unknown error',
            code: error.errorCode,
        };
    }

    processStreamedData(dto: MyFeatureDTO): { data: ListMyFeatureResponse | ListMyFeatureError; status: 'success' | 'error' } {
        if (dto.status === 'error') {
            return { status: 'error', data: { status: 'error', error: 'Processing Error', message: dto.message } };
        }
        return { status: 'success', data: { ...dto, status: 'success' } };
    }
}

export default ListMyFeatureUseCase;
```

---

### 7. Controller

```typescript
// src/lib/infrastructure/controller/list-my-feature-controller.ts
import { BaseController, TAuthenticatedControllerParameters } from '@/lib/sdk/controller';
import { injectable, inject } from 'inversify';
import USECASE_FACTORY from '../ioc/ioc-symbols-usecase-factory';

export type ListMyFeatureControllerParameters = TAuthenticatedControllerParameters & {
    param: string;
};

@injectable()
class ListMyFeatureController extends BaseController<
    ListMyFeatureControllerParameters,
    AuthenticatedRequestModel<ListMyFeatureRequest>
> {
    constructor(
        @inject(USECASE_FACTORY.LIST_MY_FEATURE)
        listMyFeatureUseCaseFactory: (response: Signal) => ListMyFeatureInputPort
    ) {
        super(listMyFeatureUseCaseFactory);
    }

    prepareRequestModel(parameters: ListMyFeatureControllerParameters): AuthenticatedRequestModel<ListMyFeatureRequest> {
        return {
            rucioAuthToken: parameters.rucioAuthToken,
            param: parameters.param,
        };
    }
}

export default ListMyFeatureController;
```

---

### 8. Presenter (Streaming)

```typescript
// src/lib/infrastructure/presenter/list-my-feature-presenter.ts
import { BaseStreamingPresenter } from '@/lib/sdk/presenter';

export default class ListMyFeaturePresenter extends BaseStreamingPresenter<
    ListMyFeatureResponse,
    ListMyFeatureError,
    MyFeatureViewModel
> {
    streamResponseModelToViewModel(responseModel: ListMyFeatureResponse): MyFeatureViewModel {
        return { ...responseModel };
    }

    streamErrorModelToViewModel(error: ListMyFeatureError): MyFeatureViewModel {
        const viewModel = getEmptyMyFeatureViewModel();
        viewModel.message = error.message;
        viewModel.status = 'error';
        return viewModel;
    }

    convertErrorModelToViewModel(errorModel: ListMyFeatureError): { status: number; viewModel: MyFeatureViewModel } {
        const viewModel = getEmptyMyFeatureViewModel();
        viewModel.message = errorModel.message;
        return { status: errorModel.code || 500, viewModel };
    }
}
```

---

### 9. View Model

```typescript
// src/lib/infrastructure/data/view-model/my-feature.ts
import { BaseViewModel } from '@/lib/sdk/view-models';

export interface MyFeatureViewModel extends BaseViewModel, MyFeature {}

export function getEmptyMyFeatureViewModel(): MyFeatureViewModel {
    return {
        status: 'error',
        // ... fields with default values
    };
}
```

---

### 10. Feature Registration

```typescript
// src/lib/infrastructure/ioc/features/list-my-feature-feature.ts
import { BaseStreamableFeature } from '@/lib/sdk/ioc-helpers';
import { Container } from 'inversify';

export default class ListMyFeatureFeature extends BaseStreamableFeature<
    ListMyFeatureControllerParameters,
    ListMyFeatureRequest,
    ListMyFeatureResponse,
    ListMyFeatureError,
    MyFeatureViewModel
> {
    constructor(appContainer: Container) {
        const myFeatureGateway = appContainer.get<MyFeatureGatewayOutputPort>(GATEWAYS.MY_FEATURE);

        const symbols = {
            CONTROLLER: CONTROLLERS.LIST_MY_FEATURE,
            USECASE_FACTORY: USECASE_FACTORY.LIST_MY_FEATURE,
            INPUT_PORT: INPUT_PORT.LIST_MY_FEATURE,
        };

        super(
            'ListMyFeature',
            ListMyFeatureController,
            ListMyFeatureUseCase,
            [myFeatureGateway],
            ListMyFeaturePresenter,
            false,
            symbols,
        );
    }
}
```

**Then register in `container-config.ts`**:

```typescript
// Bind gateway
appContainer.bind<MyFeatureGatewayOutputPort>(GATEWAYS.MY_FEATURE).to(MyFeatureGateway);

// Load feature
loadFeaturesSync(appContainer, [
    new ListMyFeatureFeature(appContainer),
    // ... other features
]);
```

---

### 11. API Route

```typescript
// src/app/api/feature/list-my-feature/route.ts
import 'reflect-metadata';
import { NextRequest, NextResponse } from 'next/server';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import { executeAuthenticatedController, parseQueryParams } from '@/lib/infrastructure/adapters/app-router-controller-adapter';

export async function GET(request: NextRequest) {
    try {
        const params = parseQueryParams(request);
        const param = params.param as string;

        if (!param) {
            return NextResponse.json({ error: 'Missing param' }, { status: 400 });
        }

        const controller = appContainer.get(CONTROLLERS.LIST_MY_FEATURE);

        return executeAuthenticatedController(
            controller,
            { param },
            true // isStreaming
        );
    } catch (error) {
        console.error('Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
```

---

### 12. React Component

```typescript
// src/component-library/pages/MyFeature/ListMyFeature.tsx
import useTableStreaming from '@/lib/infrastructure/hooks/useTableStreaming';
import { useEffect, useState } from 'react';

export const ListMyFeature = (props: { initialData?: MyFeatureViewModel[] }) => {
    const { gridApi, onGridReady, streamingHook, startStreaming } = useTableStreaming<MyFeatureViewModel>(props.initialData);
    const [startedStreaming, setStartedStreaming] = useState(false);

    useEffect(() => {
        if (!props.initialData && gridApi !== null && !startedStreaming) {
            startStreaming('/api/feature/list-my-feature');
            setStartedStreaming(true);
        }
    }, [gridApi, startStreaming, startedStreaming]);

    return (
        <div className="flex flex-col space-y-3 w-full">
            <MyFeatureTable streamingHook={streamingHook} onGridReady={onGridReady} />
        </div>
    );
};
```

---

### 13. Gateway Test

```typescript
// test/gateway/my-feature/my-feature-gateway.test.ts
import MockRucioServerFactory, { MockEndpoint } from 'test/fixtures/rucio-server';
import { Readable } from 'stream';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import GATEWAYS from '@/lib/infrastructure/ioc/ioc-symbols-gateway';

describe('MyFeatureGateway', () => {
    beforeEach(() => {
        fetchMock.doMock();

        const stream = Readable.from(
            [
                JSON.stringify({ id: '1', name: 'Item1' }),
                JSON.stringify({ id: '2', name: 'Item2' }),
            ].join('\n')
        );

        const endpoint: MockEndpoint = {
            url: `${MockRucioServerFactory.RUCIO_HOST}/my-feature/param`,
            method: 'GET',
            endsWith: 'my-feature/param',
            response: {
                status: 200,
                headers: { 'Content-Type': 'application/x-json-stream' },
                body: stream,
            },
        };

        MockRucioServerFactory.createMockRucioServer(true, [endpoint]);
    });

    afterEach(() => {
        fetchMock.dontMock();
    });

    it('should stream data', async () => {
        const gateway = appContainer.get(GATEWAYS.MY_FEATURE);
        const dto = await gateway.list(MockRucioServerFactory.VALID_RUCIO_TOKEN, 'param');

        expect(dto.status).toEqual('success');

        const receivedData = [];
        await new Promise((resolve, reject) => {
            dto.stream.on('data', (data) => receivedData.push(data));
            dto.stream.on('end', resolve);
            dto.stream.on('error', reject);
        });

        expect(receivedData.length).toEqual(2);
    });
});
```

---

## 🔑 Key Decorators & Classes

### Decorators
- `@injectable()` - Mark class for IoC container
- `@inject(SYMBOL)` - Inject dependency by symbol

### Base Classes

| Purpose | Streaming | Non-Streaming |
|---------|-----------|---------------|
| **UseCase** | `BaseSingleEndpointStreamingUseCase` | `BaseSingleEndpointUseCase` |
| **Endpoint** | `BaseStreamableEndpoint` | `BaseEndpoint` |
| **Presenter** | `BaseStreamingPresenter` | `BasePresenter` |
| **Feature** | `BaseStreamableFeature` | `BaseFeature` |
| **Controller** | `BaseController` | `BaseController` |

---

## 🎯 Common Patterns

### Get from IoC Container

```typescript
const gateway = appContainer.get<MyGatewayOutputPort>(GATEWAYS.MY_FEATURE);
const controller = appContainer.get(CONTROLLERS.LIST_MY_FEATURE);
```

### Streaming Response in API Route

```typescript
return executeAuthenticatedController(controller, { param }, true); // true = streaming
```

### Non-Streaming Response in API Route

```typescript
return executeAuthenticatedController(controller, { param }, false); // false = non-streaming
```

### Error Handling Pattern

```typescript
try {
    const endpoint = new MyEndpoint(token, param);
    const errorDTO = await endpoint.fetch();

    if (!errorDTO) {
        return { status: 'success', stream: endpoint };
    }
    return errorDTO;
} catch (error) {
    return {
        status: 'error',
        errorType: 'gateway_endpoint_error',
        errorMessage: error?.toString(),
    };
}
```

---

## 📊 Streaming vs Non-Streaming

| Aspect | Streaming | Non-Streaming |
|--------|-----------|---------------|
| **Response Format** | NDJSON (newline-delimited) | Single JSON object |
| **Content-Type** | `application/x-json-stream` | `application/json` |
| **UseCase Method** | `processStreamedData()` | `processDTO()` |
| **Gateway Returns** | `{ status: 'success', stream: endpoint }` | Single DTO |
| **API Route Flag** | `isStreaming: true` | `isStreaming: false` |
| **React Hook** | `useTableStreaming` | `useQuery` |
| **Best For** | Large datasets, real-time updates | Single records, small datasets |

---

## 🚨 Common Mistakes

1. ❌ Forgetting `'reflect-metadata'` import in API routes
2. ❌ Not setting `@injectable()` on gateway/usecase
3. ❌ Not registering feature in `container-config.ts`
4. ❌ Wrong streaming flag in `executeAuthenticatedController()`
5. ❌ Returning wrong type from `createDTO()` in endpoint
6. ❌ Not handling errors in stream processing
7. ❌ Missing `rucioAuthToken` in request model (it's added automatically)

---

## 🧪 Testing Checklist

- [ ] Mock Rucio endpoints with `MockRucioServerFactory`
- [ ] Test successful streaming with multiple items
- [ ] Test error responses (404, 500)
- [ ] Test empty streams
- [ ] Verify DTO transformation
- [ ] Test stream event handling (`data`, `end`, `error`)

---

## 📦 IoC Symbol Files

Add symbols to these files:

```typescript
// src/lib/infrastructure/ioc/ioc-symbols-gateway.ts
const GATEWAYS = {
    MY_FEATURE: Symbol.for('MyFeatureGatewayOutputPort'),
    // ...
};

// src/lib/infrastructure/ioc/ioc-symbols-controllers.ts
const CONTROLLERS = {
    LIST_MY_FEATURE: Symbol.for('ListMyFeatureController'),
    // ...
};

// src/lib/infrastructure/ioc/ioc-symbols-usecase-factory.ts
const USECASE_FACTORY = {
    LIST_MY_FEATURE: Symbol.for('ListMyFeatureUseCaseFactory'),
    // ...
};

// src/lib/infrastructure/ioc/ioc-symbols-input-port.ts
const INPUT_PORT = {
    LIST_MY_FEATURE: Symbol.for('ListMyFeatureInputPort'),
    // ...
};
```

---

## 🎨 UI Component Patterns

```typescript
// Layout
<div className="flex flex-col space-y-3 w-full grow">

// Heading
<Heading text="My Feature" />
<Heading size="sm" text="Subtitle" />

// Loading state
<InfoField><span>Loading...</span></InfoField>

// Error state
<WarningField><span>Error: {message}</span></WarningField>

// Table with streaming
<StreamedTable
    columnDefs={columnDefs}
    tableRef={tableRef}
    streamingHook={streamingHook}
    onGridReady={onGridReady}
/>
```

---

## 🔄 Data Transformation Flow

```
Rucio API JSON
    ↓
TRucio* (type)
    ↓ convertTo*DTO()
*DTO (Core DTO)
    ↓ UseCase.processStreamedData()
*Response (Response Model)
    ↓ Presenter.streamResponseModelToViewModel()
*ViewModel (View Model)
    ↓ JSON serialization
React Component
```

---

## 💡 Tips

- **Start with existing examples**: Look at `subscriptions` or `rules` features
- **Use TypeScript strictly**: Let the compiler catch errors early
- **Test incrementally**: Test gateway first, then usecase, then full feature
- **Follow naming conventions**: Makes code easier to navigate
- **Document as you go**: JSDoc comments help future developers
- **Ask for code reviews**: Ensure consistency with team patterns

---

## 📚 Reference Implementations

| Feature | Files to Study |
|---------|----------------|
| **Streaming Gateway** | `subscription-gateway/`, `rule-gateway/` |
| **Non-Streaming Gateway** | `did-gateway/get-did-endpoint.ts` |
| **Complex UseCase** | `list-rules-usecase.ts` |
| **Simple UseCase** | `get-rule-usecase.ts` |
| **Streaming Table** | `ListSubscription.tsx`, `ListRule.tsx` |
| **Gateway Tests** | `subscription-gateway.test.ts` |

---

## 🎯 Quick Start Checklist

Building a new `ListMyFeature` streaming feature:

1. [ ] Define `MyFeatureGatewayOutputPort` interface
2. [ ] Define `MyFeatureDTO` and `ListMyFeatureDTO`
3. [ ] Implement `MyFeatureGateway` class
4. [ ] Create `ListMyFeatureEndpoint` (extends `BaseStreamableEndpoint`)
5. [ ] Create `*-gateway-utils.ts` with converter functions
6. [ ] Write gateway tests
7. [ ] Define `List MyFeatureRequest/Response/Error` models
8. [ ] Define `ListMyFeatureInputPort` and `OutputPort`
9. [ ] Implement `ListMyFeatureUseCase`
10. [ ] Implement `ListMyFeatureController`
11. [ ] Implement `ListMyFeaturePresenter`
12. [ ] Define `MyFeatureViewModel`
13. [ ] Create `ListMyFeatureFeature` and register in container
14. [ ] Add symbols to IoC symbol files
15. [ ] Create API route `app/api/feature/list-my-feature/route.ts`
16. [ ] Create React component `ListMyFeature.tsx`
17. [ ] Create table component `ListMyFeatureTable.tsx`
18. [ ] Test end-to-end

---

**Keep this cheat sheet handy during development!**
