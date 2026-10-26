import { CONTROLLER_FLAG_MAP } from '@/lib/infrastructure/ioc/container-config';
import CONTROLLERS from '@/lib/infrastructure/ioc/ioc-symbols-controllers';
import appContainer from '@/lib/infrastructure/ioc/container-config';

describe('assistant IoC feature', () => {
    it('claims every assistant flag on the config controller', () => {
        expect(CONTROLLER_FLAG_MAP.get(CONTROLLERS.GET_ASSISTANT_CONFIG)).toEqual(['assistant', 'assistant.write', 'assistant.bad_replicas']);
    });

    it('binds the controller so the route can resolve it', () => {
        expect(appContainer.isBound(CONTROLLERS.GET_ASSISTANT_CONFIG)).toBe(true);
    });
});
