'use client'
import { RSE } from "@/lib/core/entity/rucio"
import useComDOM from "@/lib/infrastructure/hooks/useComDOM"
import { ComDOMStatus } from "@/lib/infrastructure/web-worker/comdom-wrapper"
import {ComDOMLifeCycle, ComDOMStatusCard} from "./comdom-status"
import ErrorList from "./errors"
import QueryInfo from "./query-info"
import RSEQueryStatus from "./rse-query-status"
import UseComDOMStatusCard from "./use-comdom-status"


export default function RSETable() {
    const {
        query,
        status,
        comDOMStatus,
        start,
        stop,
        pause,
        resume,
        clean,
        pollInterval,
        errors
    } = useComDOM<RSE>(
        'http://localhost:3000/api/stream',
        [],
        false,
        Infinity,
        200,
        true
    )

    return ( 
        <div className="bg-slate-800">
            <ErrorList errorSignal={errors.signal} errors={errors.all} resolve={errors.resolve} />
            <button className="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 mr-2 mb-2 dark:bg-blue-600 dark:hover:bg-blue-700 focus:outline-none dark:focus:ring-blue-800" onClick={async () => {
                await start()
            }}>Start</button>
            <button className="focus:outline-none text-white bg-red-700 hover:bg-red-800 focus:ring-4 focus:ring-red-300 font-medium rounded-lg text-sm px-5 py-2.5 mr-2 mb-2 dark:bg-red-600 dark:hover:bg-red-700 dark:focus:ring-red-900" onClick={async() => {
                await stop()
            }}>Stop</button>
            <button className="focus:outline-none text-white bg-yellow-400 hover:bg-yellow-500 focus:ring-4 focus:ring-yellow-300 font-medium rounded-lg text-sm px-5 py-2.5 mr-2 mb-2 dark:focus:ring-yellow-900" onClick={ async() => {
                pause()
            }}>Pause</button>
            <button className="focus:outline-none text-white bg-green-700 hover:bg-green-800 focus:ring-4 focus:ring-green-300 font-medium rounded-lg text-sm px-5 py-2.5 mr-2 mb-2 dark:bg-green-600 dark:hover:bg-green-700 dark:focus:ring-green-800" onClick={resume}>Resume</button>
            <button className="focus:outline-none text-white bg-purple-700 hover:bg-purple-800 focus:ring-4 focus:ring-purple-300 font-medium rounded-lg text-sm px-5 py-2.5 mb-2 dark:bg-purple-600 dark:hover:bg-purple-700 dark:focus:ring-purple-900" onClick={clean}>Clean</button>
            <div className="flex flex-row">Poll Interval: {pollInterval}</div>
            <div className="flex flex-row">
                <ComDOMStatusCard comDOMStatus={comDOMStatus}/>
                <RSEQueryStatus status={query.fetchStatus}/>
                <UseComDOMStatusCard status={status}/>
            </div>
            <ComDOMLifeCycle/>
        </div>
    )
}