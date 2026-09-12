#
#  SPDX-License-Identifier: Apache-2.0
#
#  Copyright The original authors
#
#  Licensed under the Apache Software License version 2.0, available at http://www.apache.org/licenses/LICENSE-2.0
#

FROM quay.io/fedora/fedora-minimal:43

RUN microdnf install -y --nodocs \
      curl \
      git \
      gh \
      jq \
      zip \
      unzip \
      tar \
      diffutils \
      patch \
      which \
      file \
      procps-ng \
      vim-common \
      python3 \
      python3-numpy \
    && microdnf clean all

# Node runs the test suite: `node tests/run.js`. Weak dependencies are off on
# purpose — it keeps nodejs-npm, nodejs-docs and nodejs-full-i18n out of the
# image, so the npm client is not merely unused but absent, and nothing here
# can reach a package registry. The suite needs no packages: it is the eight
# modules, two stubs and two runners, all in this repository.
RUN microdnf install -y --nodocs --setopt=install_weak_deps=0 nodejs \
    && microdnf clean all

# Install Claude Code (native installer)
RUN curl -fsSL https://claude.ai/install.sh | bash

ENV PATH="/root/.local/bin:$PATH"

WORKDIR /workspace

CMD ["claude"]
