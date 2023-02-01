import { useEffect, useState } from 'react'
import { RucioClient } from '../client'
import { Button } from '../stories/Button/Button'
import { Card } from '../stories/Card/Card'
import { Header } from '../stories/Header/Header'
import { Table } from '../stories/Table/Table'
import { extract_scope } from '../util'
import { useAlert } from './GlobalHooks'

export const Search = () => {
    const [selectedData, setSelectedData] = useState([] as any[])

    const showAlert: (options: AlertProps) => Promise<void> = useAlert()

    const search = () => {
        const urlSearchParams = new URLSearchParams(window?.location?.search)
        const params = Object.fromEntries(urlSearchParams?.entries())
        const [scope, name] = extract_scope(params?.pattern?.trim())

        RucioClient.DID.search(
            scope ?? '',
            name ?? '',
            'collection',
            //onSuccess
            (dids: any) => {
                if (dids && dids?.length > 0) {
                    setSelectedData(
                        dids.map((element: any) => [
                            scope + ':' + element?.id,
                            <Button
                                label="More info"
                                kind="outline"
                                onClick={() => {
                                    // TODO: fix navigation
                                    // navigate(
                                    //     `/did?scope=${scope}&name=${element?.id}`,
                                    // )
                                }}
                            ></Button>,
                        ]),
                    )
                }
            },
            //onError
            (error: any) => {
                showAlert({
                    message: 'Something went wrong, please try again.',
                    variant: 'warn',
                })
            },
        )
    }

    useEffect(() => {
        search()
    }, [])

    return (
        <div className="rule-def">
            <Header />
            <br></br>
            <Card
                header={
                    <>
                        <br></br>
                        <span className="p-l-25" style={{ fontSize: 35 }}>
                            <strong>Search</strong>
                        </span>
                    </>
                }
                content={
                    <div className="m-b-50">
                        {selectedData.length !== 0 ? (
                            <Table
                                id="didsearch"
                                columns={['Sl No.', 'DID', '']}
                                rows={selectedData}
                                footer={['Sl No.', 'DID', '']}
                            />
                        ) : (
                            <strong>No dids found</strong>
                        )}
                    </div>
                }
            ></Card>
        </div>
    )
}
