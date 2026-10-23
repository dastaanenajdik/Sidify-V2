declare module "shaka-player/dist/shaka-player.experimental.js" {
  export namespace shaka {
    namespace polyfill {
      function installAll(): void;
    }

    namespace extern {
      interface Stream {
        id: number;
        originalId: string | null;
        createSegmentIndex: () => Promise<void>;
        closeSegmentIndex?: () => void;
        segmentIndex: SegmentIndex | null;
        mimeType: string;
        codecs: string;
        supplementalCodecs?: string;
        frameRate?: number;
        pixelAspectRatio?: string;
        hdr?: string;
        colorGamut?: string;
        videoLayout?: string;
        bandwidth?: number;
        width?: number;
        height?: number;
        kind?: string;
        encrypted: boolean;
        drmInfos: unknown[];
        keyIds: Set<string>;
        language: string;
        originalLanguage?: string | null;
        label: string | null;
        type: string;
        primary: boolean;
        trickModeVideo: Stream | null;
        emsgSchemeIdUris: string[] | null;
        roles: string[];
        forced: boolean;
        channelsCount: number | null;
        audioSamplingRate: number | null;
        spatialAudio: boolean;
        closedCaptions: Map<string, string>;
        tilesLayout?: string;
        accessibilityPurpose?: unknown;
        external: boolean;
        fastSwitching: boolean;
        fullMimeTypes: Set<string>;
        isAudioMuxedInVideo: boolean;
        baseOriginalId: string | null;
        GroupId?: string | null;
      }

      interface Variant {
        id: number;
        language: string;
        disabledUntilTime: number;
        primary: boolean;
        audio: Stream | null;
        video: Stream | null;
        bandwidth: number;
        drmInfos: unknown[];
        allowedByApplication: boolean;
        allowedByKeySystem: boolean;
        decodingInfos: MediaCapabilitiesDecodingInfo[];
      }

      interface Manifest {
        presentationTimeline: InstanceType<typeof shaka.media.PresentationTimeline>;
        variants: Variant[];
        textStreams: Stream[];
        imageStreams: Stream[];
        chapterStreams: Stream[];
        offlineSessionIds: string[];
        sequenceMode: boolean;
        ignoreManifestTimestampsInSegmentsMode: boolean;
        type: string;
        serviceDescription: unknown;
        nextUrl: string | null;
        periodCount: number;
        gapCount: number;
        isLowLatency: boolean;
        startTime: number | null;
      }

      interface NetworkRequest {
        uris: string[];
        method: string;
        body?: BufferSource | null;
        headers: Record<string, string>;
        allowCrossSiteCredentials: boolean;
        retryParameters?: unknown;
      }

      interface NetworkResponse {
        uri: string;
        originalUri: string;
        data: BufferSource;
        status?: number;
        headers: Record<string, string>;
        timeMs?: number;
        fromCache?: boolean;
      }

      type RequestFilter = (
        type: number,
        request: NetworkRequest,
        context?: unknown,
      ) => Promise<void> | void;

      type ResponseFilter = (
        type: number,
        response: NetworkResponse,
        context?: unknown,
      ) => Promise<void> | void;

      interface TransmuxerOutput {
        data: Uint8Array;
        init: Uint8Array | null;
      }

      interface Transmuxer {
        destroy(): void;
        isSupported(mimeType: string, contentType?: string): boolean;
        convertCodecs(contentType: string, mimeType: string): string;
        getOriginalMimeType(): string;
        transmux(
          data: BufferSource,
          stream: Stream,
          reference: SegmentReference | null,
          duration: number,
          contentType: string,
        ): Promise<Uint8Array | TransmuxerOutput>;
      }

      type TransmuxerPlugin = () => Transmuxer;

      interface Track {
        id: number;
        active: boolean;
        type: string;
        bandwidth: number;
        language: string;
        label: string | null;
        kind: string | null;
        width: number | null;
        height: number | null;
        frameRate: number | null;
        pixelAspectRatio: string | null;
        hdr: string | null;
        colorGamut: string | null;
        videoLayout: string | null;
        mimeType: string | null;
        audioMimeType: string | null;
        videoMimeType: string | null;
        codecs: string | null;
        audioCodec: string | null;
        videoCodec: string | null;
        supplementalCodecs: string | null;
        primary: boolean;
        roles: string[];
        audioRoles: string[] | null;
        videoRoles: string[] | null;
        forced: boolean;
        videoId: number | null;
        audioId: number | null;
        channelsCount: number | null;
        audioSamplingRate: number | null;
        tilesLayout: string | null;
        spatialAudio: boolean;
         audioBandwidth: number | null;
        videoBandwidth: number | null;
        originalVideoId: string | null;
        originalAudioId: string | null;
        originalTextId: string | null;
        originalImageId: string | null;
        originalLanguage: string | null;
      }

      interface ManifestParserPlayerInterface {
        networkingEngine: {
          request(
            type: number,
            request: {
              uris: string[];
              method: string;
              body?: BufferSource | null;
              headers: Record<string, string>;
              allowCrossSiteCredentials: boolean;
              retryParameters: unknown;
            },
            context?: unknown,
          ): { promise: Promise<{ data: ArrayBuffer; headers: Record<string, string>; uri: string }> };
        };
        filter(manifest: Manifest): Promise<void>;
        makeTextStreamsForClosedCaptions(manifest: Manifest): void;
        onTimelineRegionAdded: (region: unknown) => void;
        onEvent: (event: Event) => void;
        onError: (error: InstanceType<typeof shaka.util.Error>) => void;
        isLowLatencyMode: () => boolean;
        updateDuration: () => void;
        newDrmInfo: (stream: Stream) => void;
        onManifestUpdated: (firstUpdate?: boolean) => void;
        getBandwidthEstimate: () => number;
        onMetadata: (metadataType: string, time: number, endTime: number | null, values: unknown[]) => void;
        disableStream: (stream: Stream, time: number) => boolean;
        addFont: (name: string, url: string) => void;
      }

      interface ManifestParser {
        configure(config: unknown, isPreload?: () => boolean): void;
        start(uri: string, playerInterface: ManifestParserPlayerInterface): Promise<Manifest>;
        stop(): Promise<void>;
        update(): void;
        onExpirationUpdated(sessionId: string, expiration: number): void;
        onInitialVariantChosen(variant: Variant): void;
        banLocation(uri: string): void;
        setMediaElement(mediaElement: HTMLMediaElement | null): void;
      }
    }

    type SegmentReference = InstanceType<typeof media.SegmentReference>;
    type SegmentIndex = InstanceType<typeof media.SegmentIndex>;

    namespace media {
      class InitSegmentReference {
        constructor(
          uris: () => string[],
          startByte: number,
          endByte: number | null,
          mediaQuality?: unknown,
          timescale?: number | null,
          segmentData?: BufferSource | null,
        );
        getUris(): string[];
        getStartByte(): number;
        getEndByte(): number | null;
        getSegmentData(): BufferSource | null;
      }

      class SegmentReference {
        constructor(
          startTime: number,
          endTime: number,
          uris: () => string[],
          startByte: number,
          endByte: number | null,
          initSegmentReference: InitSegmentReference | null,
          timestampOffset: number,
          appendWindowStart: number,
          appendWindowEnd: number,
        );
        startTime: number;
        endTime: number;
        getStartByte(): number;
        getEndByte(): number | null;
        getUris(): string[];
      }

      class SegmentIndex {
        constructor(references: SegmentReference[]);
        release(): void;
      }

      class PresentationTimeline {
        constructor(presentationStartTime: number | null, presentationDelay: number, autoCorrectDrift?: boolean);
        setDuration(duration: number): void;
        setStatic(isStatic: boolean): void;
        notifySegments(references: SegmentReference[]): void;
      }

      namespace ManifestParser {
        function registerParserByMime(mimeType: string, parserFactory: () => extern.ManifestParser): void;
        function unregisterParserByMime(mimeType: string): void;
        function isSupported(mimeType: string): boolean;
      }
    }

    namespace net {
      namespace NetworkingEngine {
        const RequestType: {
          MANIFEST: number;
          SEGMENT: number;
          LICENSE: number;
          APP: number;
          TIMING: number;
          SERVER_CERTIFICATE: number;
          KEY: number;
          ADS: number;
          CONTENT_STEERING: number;
        };
        function makeRequest(uris: string[], retryParameters: unknown): {
          uris: string[];
          method: string;
          body?: BufferSource | null;
          headers: Record<string, string>;
          allowCrossSiteCredentials: boolean;
          retryParameters: unknown;
        };
      }
    }

    namespace transmuxer {
      namespace TransmuxerEngine {
        const PluginPriority: {
          FALLBACK: number;
          PREFERRED_SECONDARY: number;
          PREFERRED: number;
          APPLICATION: number;
        };
        function registerTransmuxer(
          mimeType: string,
          plugin: extern.TransmuxerPlugin,
          priority?: number,
        ): void;
        function unregisterTransmuxer(mimeType: string): void;
        function findTransmuxer(mimeType: string): extern.TransmuxerPlugin | null;
        function isSupported(mimeType: string, contentType?: string): boolean;
        function convertCodecs(contentType: string, mimeType: string): string;
      }

      class MatroskaTransmuxer implements extern.Transmuxer {
        constructor(mimeType: string);
        destroy(): void;
        isSupported(mimeType: string, contentType?: string): boolean;
        convertCodecs(contentType: string, mimeType: string): string;
        getOriginalMimeType(): string;
        transmux(
          data: BufferSource,
          stream: extern.Stream,
          reference: SegmentReference | null,
          duration: number,
          contentType: string,
        ): Promise<Uint8Array | extern.TransmuxerOutput>;
      }

      class Ec3Transmuxer implements extern.Transmuxer {
        constructor(mimeType: string);
        destroy(): void;
        isSupported(mimeType: string, contentType?: string): boolean;
        convertCodecs(contentType: string, mimeType: string): string;
        getOriginalMimeType(): string;
        transmux(
          data: BufferSource,
          stream: extern.Stream,
          reference: SegmentReference | null,
          duration: number,
          contentType: string,
        ): Promise<Uint8Array | extern.TransmuxerOutput>;
      }

      class Ac3Transmuxer implements extern.Transmuxer {
        constructor(mimeType: string);
        destroy(): void;
        isSupported(mimeType: string, contentType?: string): boolean;
        convertCodecs(contentType: string, mimeType: string): string;
        getOriginalMimeType(): string;
        transmux(
          data: BufferSource,
          stream: extern.Stream,
          reference: SegmentReference | null,
          duration: number,
          contentType: string,
        ): Promise<Uint8Array | extern.TransmuxerOutput>;
      }

      class MpegTsTransmuxer implements extern.Transmuxer {
        constructor(mimeType: string);
        destroy(): void;
        isSupported(mimeType: string, contentType?: string): boolean;
        convertCodecs(contentType: string, mimeType: string): string;
        getOriginalMimeType(): string;
        transmux(
          data: BufferSource,
          stream: extern.Stream,
          reference: SegmentReference | null,
          duration: number,
          contentType: string,
        ): Promise<Uint8Array | extern.TransmuxerOutput>;
      }

      class TsTransmuxer implements extern.Transmuxer {
        constructor(mimeType: string);
        destroy(): void;
        isSupported(mimeType: string, contentType?: string): boolean;
        convertCodecs(contentType: string, mimeType: string): string;
        getOriginalMimeType(): string;
        transmux(
          data: BufferSource,
          stream: extern.Stream,
          reference: SegmentReference | null,
          duration: number,
          contentType: string,
        ): Promise<Uint8Array | extern.TransmuxerOutput>;
      }
    }

    namespace util {
      class Error {
        constructor(severity: number, category: number, code: number, ...args: unknown[]);
        severity: number;
        category: number;
        code: number;
        data: unknown[];
        handled: boolean;
        message: string;
        static Severity: {
          RECOVERABLE: number;
          CRITICAL: number;
        };
        static Category: {
          NETWORK: number;
          TEXT: number;
          MEDIA: number;
          MANIFEST: number;
          STREAMING: number;
          DRM: number;
          PLAYER: number;
          CAST: number;
          STORAGE: number;
          ADS: number;
        };
        static Code: Record<string, number>;
      }

      namespace MimeUtils {
        function getBasicType(mimeType: string): string;
        function getCodecs(mimeType: string): string;
        function getCodecBase( codecs: string): string;
        function getFullType(mimeType: string, codecs?: string): string;
        function getFullOrConvertedType(mimeType: string, codecs?: string, contentType?: string): string;
      }

      namespace BufferUtils {
        function toUint8(data: BufferSource, offset?: number, length?: number): Uint8Array;
      }
    }

    class Player {
      static isBrowserSupported(): boolean;
      static version: string;

      constructor(mediaElement?: HTMLMediaElement | null, dependencyInjector?: (player: Player) => void);

      attach(mediaElement: HTMLMediaElement, initializeMediaSource?: boolean): Promise<void>;
      detach(): Promise<void>;
      destroy(): Promise<void>;
      load(manifestUri: string, startTime?: number | null, mimeType?: string): Promise<void>;
      unload(initializeMediaSource?: boolean): Promise<void>;
      configure(config: Record<string, unknown> | string, value?: unknown): boolean;
      getConfiguration(): Record<string, unknown>;
      getMediaElement(): HTMLMediaElement | null;
      getNetworkingEngine(): {
        registerRequestFilter(filter: extern.RequestFilter): void;
        unregisterRequestFilter(filter: extern.RequestFilter): void;
        registerResponseFilter(filter: extern.ResponseFilter): void;
        unregisterResponseFilter(filter: extern.ResponseFilter): void;
      } | null;
      getAssetUri(): string | null;
      getLoadMode(): number;
      getManifestType(): string | null;
      getVariantTracks(): extern.Track[];
      getTextTracks(): extern.Track[];
      selectVariantTrack(track: extern.Track, clearBuffer?: boolean, safeMargin?: number): void;
      selectAudioLanguage(language: string, role?: string, channelsCount?: number): void;
      selectVariantsByLabel(label: string, clearBuffer?: boolean): void;
      selectTextTrack(track: extern.Track): void;
      setTextTrackVisibility(isVisible: boolean): Promise<void>;
      isTextTrackVisible(): boolean;
      addEventListener(type: string, listener: (event: Event & { detail?: unknown }) => void): void;
      removeEventListener(type: string, listener: (event: Event & { detail?: unknown }) => void): void;

      static LoadMode: {
        NOT_LOADED: number;
        MEDIA_SOURCE: number;
        SRC_EQUALS: number;
      };
    }
  }

  export default shaka;
}
