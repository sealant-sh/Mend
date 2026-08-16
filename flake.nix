{
  description = "Mend development shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/6b5e5b7a6631f065bf6908986990b37d845f847f";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-darwin"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          pnpm = (pkgs.pnpm_10.override { nodejs-slim = pkgs.nodejs-slim_26; }).overrideAttrs (_: {
            version = "10.32.1";
            src = pkgs.fetchurl {
              url = "https://registry.npmjs.org/pnpm/-/pnpm-10.32.1.tgz";
              hash = "sha256-m5Q7lLyPVe+5k6rY5EtTjmsJHmCp5KlE3N6GmFXyM+M=";
            };
          });
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_26
              pnpm
            ];
          };
        }
      );
    };
}
