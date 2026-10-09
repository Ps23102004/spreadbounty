// Minimal human-readable ABIs, copied from @kuru-labs/kuru-sdk 0.0.95 (abi/*.json).
// test/selftest.ts checks every selector and topic here against the SDK's JSON ABIs.

export const ORDERBOOK_ABI = [
  "function getMarketParams() view returns (uint32 pricePrecision, uint96 sizePrecision, address baseAsset, uint256 baseDecimals, address quoteAsset, uint256 quoteDecimals, uint32 tickSize, uint96 minSize, uint96 maxSize, uint256 takerFeeBps, uint256 makerFeeBps)",
  "function bestBidAsk() view returns (uint256, uint256)",
  "function getVaultParams() view returns (address, uint256, uint96, uint256, uint96, uint96, uint96, uint96)",
  "function s_orders(uint40) view returns (address ownerAddress, uint96 size, uint40 prev, uint40 next, uint40 flippedId, uint32 price, uint32 flippedPrice, bool isBuy)",
  "function addBuyOrder(uint32 _price, uint96 size, bool _postOnly)",
  "function addSellOrder(uint32 _price, uint96 size, bool _postOnly)",
  "function batchCancelOrders(uint40[] _orderIds)",
  "event OrderCreated(uint40 orderId, address owner, uint96 size, uint32 price, bool isBuy)",
  "event OrdersCanceled(uint40[] orderId, address owner)",
  "event Trade(uint40 orderId, address makerAddress, bool isBuy, uint256 price, uint96 updatedSize, address takerAddress, address txOrigin, uint96 filledSize)",
  "event FlipOrderCreated(uint40 orderId, uint40 flippedId, address owner, uint96 size, uint32 price, uint32 flippedPrice, bool isBuy)",
  "event FlippedOrderCreated(uint40 orderId, uint40 flippedId, address owner, uint96 size, uint32 price, uint32 flippedPrice, bool isBuy)",
  "event FlipOrderUpdated(uint40 orderId, uint96 size)",
  "event FlipOrdersCanceled(uint40[] orderIds, address owner)",
  "event Upgraded(address indexed implementation)",
  "error InsufficientLiquidity()",
  "error MarketStateError()",
  "error PostOnlyError()",
  "error PriceError()",
  "error SizeError()",
  "error SlippageExceeded()",
  "error TickSizeError()",
  "error TooMuchSizeFilled()",
  "error Unauthorized()",
  "error OrderAlreadyFilledOrCancelled()",
];

export const ROUTER_ABI = [
  "function verifiedMarket(address) view returns (uint32, uint96, address, uint256, address, uint256, uint32, uint96, uint96, uint256, uint256)",
  "function orderBookImplementation() view returns (address)",
  "function anyToAnySwap(address[] _marketAddresses, bool[] _isBuy, bool[] _nativeSend, address _debitToken, address _creditToken, uint256 _amount, uint256 _minAmountOut) payable returns (uint256)",
  "event KuruRouterSwap(address msgSender, address debitToken, address creditToken, uint256 amountIn, uint256 amountOut)",
  "error InsufficientBalance(uint256, uint256)",
  "error InvalidMarket()",
  "error SlippageExceeded()",
  "error LengthMismatch()",
];

export const MARGIN_ABI = [
  "function deposit(address _user, address _token, uint256 _amount) payable",
  "function withdraw(uint256 _amount, address _token)",
  "function getBalance(address _user, address _token) view returns (uint256)",
  "function verifiedMarket(address) view returns (bool)",
  "error InsufficientBalance()", // MarginAccount; Router has InsufficientBalance(uint256,uint256)
  "error NativeAssetMismatch()",
  "error OnlyVerifiedMarketsAllowed()",
  "error ProtocolPaused()",
];

export const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
];
