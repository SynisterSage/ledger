// Phase 3 compatibility entrypoint. The implementation now lives in the
// shared external-embed system so compatible Ledger editors use one node.
export {
  ExternalEmbedNode as FigmaEmbedNode,
  ExternalEmbedProvider as FigmaEmbedProvider,
  $createExternalEmbedNode as $createFigmaEmbedNode,
  $isExternalEmbedNode as $isFigmaEmbedNode,
} from '../../ExternalEmbeds/ExternalEmbedNode';
export type {
  SerializedExternalEmbedNode as SerializedFigmaEmbedNode,
} from '../../ExternalEmbeds/ExternalEmbedNode';
