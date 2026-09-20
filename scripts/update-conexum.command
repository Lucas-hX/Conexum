#!/bin/zsh

set -euo pipefail

script_directory=${0:A:h}
repository_directory=${script_directory:h}
target_application=${CONEXUM_APP_PATH:-/Applications/Conexum.app}

print_step() {
  printf '\n\033[1;34mConexum\033[0m · %s\n' "$1"
}

fail() {
  printf '\n\033[1;31mNo se pudo actualizar Conexum:\033[0m %s\n' "$1" >&2
  exit 1
}

[[ $(uname -s) == Darwin ]] || fail 'este actualizador sólo funciona en macOS.'
for dependency in git pnpm ditto pgrep; do
  command -v "$dependency" >/dev/null 2>&1 || fail "falta el comando requerido: $dependency"
done

[[ $target_application == /*/Conexum.app ]] || fail 'CONEXUM_APP_PATH debe ser una ruta absoluta terminada en Conexum.app.'
[[ ${target_application:h} != / ]] || fail 'no se permite instalar directamente en la raíz del sistema.'

cd "$repository_directory"
[[ $(git branch --show-current) == main ]] || fail 'cambiá a la rama main antes de actualizar.'
[[ -z $(git status --porcelain) ]] || fail 'hay cambios locales sin guardar; confirmalos o guardalos antes de actualizar.'

print_step 'Buscando la última versión estable…'
git fetch origin main
git pull --ff-only origin main

print_step 'Instalando dependencias verificadas…'
pnpm install --frozen-lockfile
pnpm run rebuild:native

print_step 'Ejecutando pruebas y compilación…'
pnpm run check
pnpm run package:mac

source_application=$(find "$repository_directory/release" -maxdepth 2 -type d -name 'Conexum.app' -print -quit)
[[ -n $source_application && -d $source_application ]] || fail 'el empaquetado terminó sin generar Conexum.app.'

if pgrep -x Conexum >/dev/null 2>&1; then
  fail 'Conexum está abierto. Cerralo normalmente y volvé a ejecutar este archivo.'
fi

target_directory=${target_application:h}
mkdir -p "$target_directory"
temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/conexum-update.XXXXXX")
previous_application="$temporary_directory/Conexum.previous.app"

restore_previous() {
  exit_status=$?
  trap - EXIT INT TERM
  if (( exit_status != 0 )) && [[ -d $previous_application ]]; then
    if [[ -e $target_application ]]; then
      mv "$target_application" "$temporary_directory/Conexum.failed.app" 2>/dev/null || true
    fi
    mv "$previous_application" "$target_application" 2>/dev/null || true
  fi
  rm -rf "$temporary_directory"
  exit $exit_status
}
trap restore_previous EXIT INT TERM

print_step "Instalando en $target_application…"
if [[ -e $target_application ]]; then
  mv "$target_application" "$previous_application"
fi
ditto "$source_application" "$target_application"

trap - EXIT INT TERM
rm -rf "$temporary_directory"

print_step 'Actualización terminada. Abriendo Conexum…'
open "$target_application"

