import { parsedEndpoint } from '../util'
import { AccountConfig } from '../utils/config'
import { streamData } from '../utils/restApiWrapper'

class AccountLimit {
    public static getAccountLimits(
        account: string,
        onSuccess = (args?: unknown) => args,
        onError = (args?: unknown) => args,
    ) {
        const url = parsedEndpoint(AccountConfig?.endpoints?.limit, {
            account: account,
        })
        streamData(url)
            .then((data: any) => {
                onSuccess?.(data)
            })
            .catch((error: unknown) => {
                onError?.(error)
            })
    }
}

export { AccountLimit }
