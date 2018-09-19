import { EventEmitter } from "events";

export interface Config {
    version: string;
    publicKeys: string[];
    manifests: string[];
    nightly?: boolean;
}

export class Updater extends EventEmitter {
    checkForUpdates(manifestURLIndex?: number): void;
    checkPeriodically(interval?: number): void;
    stopCheckingPeriodically(): void;
    failedInstallAttempts(): Promise<number>;
    cleanup(): void;
    scheduleInstallOnQuit(): void;
    quitAndInstall(): void;
    quitAndRetryInstall(allowLocal?: boolean): void;
}

type init = (config?: Config) => Updater;

export default init;
