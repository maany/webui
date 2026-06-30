import MockRucioServerFactory, { MockEndpoint } from 'test/fixtures/rucio-server';
import ReplicaGatewayOutputPort from '@/lib/core/port/secondary/replica-gateway-output-port';
import appContainer from '@/lib/infrastructure/ioc/container-config';
import GATEWAYS from '@/lib/infrastructure/ioc/ioc-symbols-gateway';
import { ListSuspiciousReplicasDTO, SuspiciousReplicaDTO } from '@/lib/core/dto/replica-dto';

describe('Replica Gateway: List Suspicious Replicas', () => {
    beforeEach(() => {
        fetchMock.doMock();
        const listSuspiciousReplicasEndpoint: MockEndpoint = {
            url: `${MockRucioServerFactory.RUCIO_HOST}/replicas/suspicious/`,
            method: 'GET',
            includes: 'replicas/suspicious',
            response: {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify([
                    {
                        scope: 'test',
                        name: 'suspicious_test_file_1.dat',
                        rse: 'MOCK_SUSPICIOUS',
                        rse_id: '6762d2e939bd41a89a012f40d038843e',
                        cnt: 3,
                        created_at: 'Wed, 18 Mar 2026 09:08:23 UTC',
                    },
                    {
                        scope: 'test',
                        name: 'suspicious_test_file_2.dat',
                        rse: 'MOCK_SUSPICIOUS',
                        rse_id: '6762d2e939bd41a89a012f40d038843e',
                        cnt: 5,
                        created_at: 'Wed, 18 Mar 2026 10:08:23 UTC',
                    },
                ]),
            },
        };
        MockRucioServerFactory.createMockRucioServer(true, [listSuspiciousReplicasEndpoint]);
    });

    afterEach(() => {
        fetchMock.resetMocks();
    });

    it('should successfully fetch a list of suspicious replicas', async () => {
        const rucioReplicaGateway: ReplicaGatewayOutputPort = appContainer.get<ReplicaGatewayOutputPort>(GATEWAYS.REPLICA);
        const dto: ListSuspiciousReplicasDTO = await rucioReplicaGateway.listSuspiciousReplicas(MockRucioServerFactory.VALID_RUCIO_TOKEN);
        expect(dto.status).toBe('success');
        expect(dto.replicas.length).toBe(2);
        expect(dto.replicas[0]).toEqual({
            status: 'success',
            scope: 'test',
            name: 'suspicious_test_file_1.dat',
            rse: 'MOCK_SUSPICIOUS',
            rseId: '6762d2e939bd41a89a012f40d038843e',
            cnt: 3,
            createdAt: 'Wed, 18 Mar 2026 09:08:23 UTC',
        } as SuspiciousReplicaDTO);
        expect(dto.replicas[1].name).toBe('suspicious_test_file_2.dat');
        expect(dto.replicas[1].cnt).toBe(5);
    });

    it('should map the optional reason field correctly', async () => {
        fetchMock.resetMocks();
        const endpointWithReason: MockEndpoint = {
            url: `${MockRucioServerFactory.RUCIO_HOST}/replicas/suspicious/`,
            method: 'GET',
            includes: 'replicas/suspicious',
            response: {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([
                    {
                        scope: 'test',
                        name: 'suspicious_with_reason.dat',
                        rse: 'MOCK_SUSPICIOUS',
                        rse_id: '6762d2e939bd41a89a012f40d038843e',
                        cnt: 1,
                        created_at: 'Wed, 18 Mar 2026 09:08:23 UTC',
                        reason: 'Checksum mismatch',
                    },
                    {
                        scope: 'test',
                        name: 'suspicious_no_reason.dat',
                        rse: 'MOCK_SUSPICIOUS',
                        rse_id: '6762d2e939bd41a89a012f40d038843e',
                        cnt: 2,
                        created_at: 'Wed, 18 Mar 2026 10:08:23 UTC',
                    },
                ]),
            },
        };
        MockRucioServerFactory.createMockRucioServer(true, [endpointWithReason]);

        const rucioReplicaGateway: ReplicaGatewayOutputPort = appContainer.get<ReplicaGatewayOutputPort>(GATEWAYS.REPLICA);
        const dto: ListSuspiciousReplicasDTO = await rucioReplicaGateway.listSuspiciousReplicas(MockRucioServerFactory.VALID_RUCIO_TOKEN);
        expect(dto.status).toBe('success');
        expect(dto.replicas.length).toBe(2);
        expect(dto.replicas[0].reason).toBe('Checksum mismatch');
        expect(dto.replicas[1].reason).toBeUndefined();
    });

    it('should fail with an auth error', async () => {
        const rucioReplicaGateway: ReplicaGatewayOutputPort = appContainer.get<ReplicaGatewayOutputPort>(GATEWAYS.REPLICA);
        const dto: ListSuspiciousReplicasDTO = await rucioReplicaGateway.listSuspiciousReplicas('invalid-token');
        expect(dto.status).toBe('error');
        expect(dto.errorCode).toBe(401);
    });
});
