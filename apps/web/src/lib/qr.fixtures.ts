// SPDX-License-Identifier: AGPL-3.0-or-later
// Reference matrices from the npm package qrcode 1.5.4 (byte mode, level L), generated once.
// `hex` is the module grid row by row, one bit per module (1 = dark), packed big-endian.
// `mask: null` means the reference chose the mask itself (`chosenMask`).

export interface QrFixture {
  text: string;
  mask: number | null;
  version: number;
  chosenMask: number;
  hex: string;
}

export const QR_FIXTURES: QrFixture[] = [
  {
    text: 'hi',
    mask: null,
    version: 1,
    chosenMask: 2,
    hex: 'fe4bfc14906e90bb7525dba3aec17507faafe00700fbcd55214851cd3dea034ae54a805f27fa2c504fc9baa925d6492ea53905834fef4f0',
  },
  {
    text: 'Green Envelope',
    mask: null,
    version: 1,
    chosenMask: 4,
    hex: 'fe8bfc16906ebebb7555dba6aec15507faafe00000ce1979080524e8bd38a93fae9080593ff98a5059b1baf405d217ee8961052a0fef588',
  },
  {
    text: 'txch1h7kq3m0p9fj2u8s4x6w5e7r9t0y2a4c6d8g0l3n5v7z9k2m4p6q8s0sq4u5l',
    mask: 0,
    version: 4,
    chosenMask: 0,
    hex: 'fe49713fc11c9cd06eba2ecbb74e7335dba219daec122fad07faaaaafe01dcff00efb65ce22a9b777255d03201ba12aabc2628d6620206f3313edae108ee031ed9f957d64c74e64b5558c3d83abb6f32dad221eec7630188c131365be2ba36b99afaa296324dfd805846467fa93aebf05a3dd18bae866fcdd2e3386aebe98737055f8982fef3ccd18',
  },
  {
    text: 'txch1h7kq3m0p9fj2u8s4x6w5e7r9t0y2a4c6d8g0l3n5v7z9k2m4p6q8s0sq4u5l',
    mask: 1,
    version: 4,
    chosenMask: 1,
    hex: 'fe9c243fc17636506e8f7b8bb744d995dbaf4c8aec14850507faaaaafe01765500e6e309f98031ddd8c0856754f0b80016837d833750ac599b978fb45dbaa9b4735302831921cce1fff2568d6fee2598707884bb923653226b9b9f0eb7ef6213305008c36718f88072ecc4ff9c6faab05097712ba3d33f9dd04992c2eabcd26305f52328fea699848',
  },
  {
    text: 'txch1h7kq3m0p9fj2u8s4x6w5e7r9t0y2a4c6d8g0l3n5v7z9k2m4p6q8s0sq4u5l',
    mask: 2,
    version: 4,
    chosenMask: 2,
    hex: 'fe2aff3fc152a4106e82cd4bb75dfd05dba4213aec16cc2107faaaaafe00e41c00fbd5d2d548154f91dbe8d18f82b12484c5a6ee818c2e10bf06396f300d89263a776f35c24c04c56dbb4de0d935579154eac260ff808fa022bf0eb86c82d533a2192caed1c3fd00567ec5ffb1d96bd049b3f16ba8be8fc5d600b652ea67bfd505676a0cfe9042e90',
  },
  {
    text: 'txch1h7kq3m0p9fj2u8s4x6w5e7r9t0y2a4c6d8g0l3n5v7z9k2m4p6q8s0sq4u5l',
    mask: 3,
    version: 4,
    chosenMask: 3,
    hex: 'feaaff3fc13f12d06eb9a0ebb75dfd05dba997e2ec11a19507faaaaafe0052c700f2b8644ec8154f91f6de0ae2399c925fa5a6ee818988cbd2b15cd9eb6189263a77dbeeaffae873b6d6cde0d935410a395c1ff624ed3fa022bf0c6b01340e8179749aaed1c3fd007bc846bf8ab4eb1049b3f16ba5085fadd56d008aea67bfd505d1b161fefdf4320',
  },
  {
    text: 'txch1h7kq3m0p9fj2u8s4x6w5e7r9t0y2a4c6d8g0l3n5v7z9k2m4p6q8s0sq4u5l',
    mask: 4,
    version: 4,
    chosenMask: 4,
    hex: 'feede33fc1712a106eacf5abb75ae175dba050faec14f4c107faaaaafe0095db00ce12ce97f0f6c1a938e6e96c133638f502ba9f4697a0285c88098cbe349157fd6b1ef2de3dbc26e383aeeee1d6c616489b057c8e47942e1a5c80888f0cec2bd3de30df16dffc8075f0c53f9fe1aa505eaf91abaccf4fddd03855dee88431ed0516ad10fed75e988',
  },
  {
    text: 'txch1h7kq3m0p9fj2u8s4x6w5e7r9t0y2a4c6d8g0l3n5v7z9k2m4p6q8s0sq4u5l',
    mask: 5,
    version: 4,
    chosenMask: 5,
    hex: 'fe1c243fc13226106e82cd4bb7518cc5dbac213aec10c40107faaaaafe00661400c755d28c5464888d9be8d18f80b90406c37d833754ac189f86396f300df8e126066f35c24c0ce5efb3568d6fee35997468c260ff808e673ececab86c82d51320110cc36718f88076fcc5ffb1d96bd055c2317ba0be8fc5d00896d2e8bcd26305e5622cfe9042e90',
  },
  {
    text: 'txch1h7kq3m0p9fj2u8s4x6w5e7r9t0y2a4c6d8g0l3n5v7z9k2m4p6q8s0sq4u5l',
    mask: 6,
    version: 4,
    chosenMask: 6,
    hex: 'fe9c243fc1312a106e8be9cbb7418cc5dba505aaec11421907faaaaafe016a2400da7140a0d464888d92cc43c6a13f1c67437d833757a0285c8b1dfd7929f8e126064ba78b688afd8e35568d6fee39a9b764f6f2b6a41e673ececa2a25a6470b419714c36718f88075f0c53f98fdeb9045c2317ba99a1f8dd58e8eb2e8bcd26305e952effeb4d0a00',
  },
  {
    text: 'txch1h7kq3m0p9fj2u8s4x6w5e7r9t0y2a4c6d8g0l3n5v7z9k2m4p6q8s0sq4u5l',
    mask: 7,
    version: 4,
    chosenMask: 7,
    hex: 'fe49713fc14ed5d06ebebc8bb74e7335dba850faec16bde507faaaaafe0195db00d32415bb2a9b777247991693fe80e398b628d662004fd7a37648a82c7c031ed9f91ef2de3df40271ca83d83abb6616489b03a7e3f14988c131377f70f312f0be68eb96324dfd804a0f46ffada8aad04a3dd18ba4cf4fddd671714ee9e987370516ad10fee185f50',
  },
  {
    text: 'txch1h7kq3m0p9fj2u8s4x6w5e7r9t0y2a4c6d8g0l3n5v7z9k2m4p6q8s0sq4u5l',
    mask: null,
    version: 4,
    chosenMask: 7,
    hex: 'fe49713fc14ed5d06ebebc8bb74e7335dba850faec16bde507faaaaafe0195db00d32415bb2a9b777247991693fe80e398b628d662004fd7a37648a82c7c031ed9f91ef2de3df40271ca83d83abb6616489b03a7e3f14988c131377f70f312f0be68eb96324dfd804a0f46ffada8aad04a3dd18ba4cf4fddd671714ee9e987370516ad10fee185f50',
  },
  {
    text: 'xch1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
    mask: null,
    version: 4,
    chosenMask: 0,
    hex: 'fe21113fc122eed06ea4222bb7497775dba49112ec11eeed07faaaaafe012eee00ef8c44627aef77525aee888ff01deee207bb24474b678775272b9088fb93e2ee22170844740e1e7752ffee888ffa0deee2106924474b4f97752eea9088fec862ee22a64844fc004e77467fbe88ebf051eed13ba9244fd5d1977066eb108b7b0562ed82fee845ed8',
  },
  {
    text: 'https://clapandpay.com/g/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA?from=Anna#bbbbbbbbbbbbbbbbbbbbbb',
    mask: null,
    version: 6,
    chosenMask: 4,
    hex: 'fef6b06abfc1537a35906ebef1cf8bb755342fe5dba04a16f2ec1539c76907faaaaaaafe0054e86800ce0d1ad517eac958151d3ffdc2fd3c2084b8e3c599f34de89c81ec710b98ffcfe51c4392c3e7e86c6bcfac1ad5c712a358153f04d642fd1a251278e3c697f6e5e81c8722250bf8ff3c831c4b925bd4e84ceb0edd1ad546e25158351f0297c2e51ba632b8e4d51c7c45eb7c87e4710be8f48ee71c7b923b65e85c6ad7ac1ac7fe8063583bc63f8642f4eab05a78e4f11ba8e5e8dfc5d22d0bfa3ee8871c6f5305d5e84cdbfedc1ac4d70',
  },
  {
    text: 'Grüße aus Köln: Grüße aus Köln: Grüße aus Köln: Grüße aus Köln: Grüße aus Köln: Grüße aus Köln: Grüße aus Köln: Grüße aus Köln: Grüße aus Köln: Grüße aus Köln: ',
    mask: null,
    version: 8,
    chosenMask: 2,
    hex: 'fe6030ce04bfc15893703dd06e8fc047b36bb75b6b32e6a5dba26b7fbf02ec14d7d1cd1107faaaaaaaaafe00ffa4656e00fb97ebe640d55288a2eb8bcdf5c52a255a31058469016120686cd02b2fed486812affc52181ae48e21ba891bee08bd50c2c292dff7771e96af106fe97e50eb923f6962c99b070344e5d8725cbe7c94138c9929b0b0c4fff2bfb7a7e5f1769c56df189aac8eb4ffaedc65291de6c5affb89fa1abe95a86baff6182d6e09806ffc69a13335fed5abfe192790f597980073348802b39dc9e3cd7faae5190b08086dced3daf29c47ad6a914ef284638ec1dff4ece350af56e8251c789cc1aee6e156baf32080e3a99fe4b9fb005fb51ecec6bfa21ea88eab704d0c4678912bae9afeb5cffdd680947c4ecaea0d3ded2cc10566a554a3e1fec1e35dfd838',
  },
  {
    text: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    mask: 3,
    version: 9,
    chosenMask: 3,
    hex: 'fede53ae0d23fc13c35993e7906eb906a2a7c4bb7509f2f6b0d5dbabd3ef8d622ec1135847e53107faaaaaaaaaafe0095831e53c00f2814ef8358ceae0b291706b8557861aac9f2bece8c836153e7312234f8fb583dfda929fcc6b0e8dde5ac77f29d3730435ba3e51ea3eaf954d83504ea3df27ab0633bac8c1c129f0811ba580ce53c5ca7b14e20358b212ab291706b8570d81aac9f2bec837836153e7317fecf8fb583ffac769fc46b0c4faafac2bf29ab6d1a35b13e511a2f8794fd834fcd00df2d2b069b98bec1ab29f621a165826e53efc5f114f883591a3cbb29bf06b2d678a1ac69f2d4c884834b53e591d2ecf95358277fe769f646b040f2c9ac1df29b9618635903e534ae64394e5834ac886af2d2b069bb7f0c1ab29f620c099826e53efd12d54ff8359fb804029c706b457f909aaa9f2aad045437153e711ba4cf8fb583ffdd599fb06b0946eb92c29f298d505d75a53e501afe8394358347d0',
  },
];
