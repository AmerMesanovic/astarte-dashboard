/*
   This file is part of Astarte.

   Copyright 2020 Ispirata Srl

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

import React, { useEffect, useState } from 'react';
import { Card, Container, Spinner, Table } from 'react-bootstrap';
import _ from 'lodash';

import BackButton from './ui/BackButton';
import WaitForData from './components/WaitForData';
import useFetch from './hooks/useFetch';
import { useAlerts } from './AlertManager';

const MAX_SHOWN_VALUES = 20;

function isSingleAstarteValue(data) {
  return _.isBoolean(data) || _.isNumber(data) || _.isString(data);
}

function isArrayAstarteValue(data) {
  return _.isArray(data) && data.every(isSingleAstarteValue);
}

function isEmptyAstarteValue(data) {
  return _.isNull(data);
}

function isAstarteValue(data) {
  return isEmptyAstarteValue(data) || isSingleAstarteValue(data) || isArrayAstarteValue(data);
}

function linearizePathTree(path, data, timestamp) {
  if ('value' in data && isAstarteValue(data.value)) {
    return [{ path, value: data.value, timestamp: data.timestamp || timestamp }];
  }
  if (isAstarteValue(data)) {
    return [{ path, value: data, timestamp }];
  }
  if (_.isEmpty(data)) {
    return [];
  }
  if (_.isArray(data.value)) {
    return data.value
      .map((value) => linearizePathTree(`${path}/value`, value, data.timestamp || timestamp))
      .flat();
  }
  if (_.isObject(data.value)) {
    return linearizePathTree(`${path}/value`, data.value, data.timestamp || timestamp).flat();
  }
  if (_.isArray(data)) {
    return data.map((value) => linearizePathTree(path, value, timestamp)).flat();
  }
  if (_.isObject(data)) {
    if (_.values(data).every(isAstarteValue)) {
      return [{ path, value: data, timestamp: data.timestamp || timestamp }];
    }
    return Object.entries(data)
      .map(([key, value]) =>
        linearizePathTree(`${path}/${key}`, value, data.timestamp || timestamp),
      )
      .flat();
  }
  return [];
}

function formatAstarteValue(value) {
  if (value == null) {
    return '';
  }
  if (_.isArray(value)) {
    return JSON.stringify(value);
  }
  if (_.isBoolean(value)) {
    return value ? 'true' : 'false';
  }
  if (_.isNumber(value)) {
    return value.toString();
  }
  return String(value);
}

const DeviceInterfaceValues = ({ astarte, deviceId, interfaceName }) => {
  const [interfaceType, setInterfaceType] = useState(null);
  const deviceData = useFetch(() =>
    astarte.getDeviceData({
      deviceId,
      interfaceName,
    }),
  );

  const deviceAlerts = useAlerts();

  useEffect(() => {
    if (!_.isEmpty(deviceData.error)) {
      deviceAlerts.showError('Could not retrieve interface data.');
    }
  }, [deviceData.error]);

  useEffect(() => {
    const getInterfaceType = async () => {
      const device = await astarte.getDeviceInfo(deviceId).catch(() => {
        throw new Error('Device not found.');
      });
      const interfaceIntrospection = device.introspection[interfaceName];

      if (!interfaceIntrospection) {
        throw new Error('Interface not found in device introspection.');
      }

      const iface = await astarte
        .getInterface({
          interfaceName,
          interfaceMajor: interfaceIntrospection.major,
        })
        .catch(() => {
          throw new Error('Could not retrieve interface properties.');
        });

      if (iface.type === 'properties') {
        setInterfaceType('properties');
      } else if (iface.type === 'datastream' && iface.aggregation === 'object') {
        setInterfaceType('datastream-object');
      } else {
        setInterfaceType('datastream-individual');
      }
    };

    getInterfaceType().catch((err) => {
      deviceAlerts.showError(err.message);
    });
  }, []);

  return (
    <Container fluid className="p-3">
      <h2>
        <BackButton href={`/devices/${deviceId}/edit`} />
        Interface Data
      </h2>
      <Card className="mt-4">
        <Card.Header>
          <span className="text-monospace">{deviceId}</span> /{interfaceName}
        </Card.Header>
        <Card.Body>
          <deviceAlerts.Alerts />
          <WaitForData
            data={deviceData.value}
            status={deviceData.status}
            fallback={
              _.isEmpty(deviceData.error) ? <Spinner animation="border" role="status" /> : <></>
            }
          >
            {(interfaceData) => <InterfaceData data={interfaceData} type={interfaceType} />}
          </WaitForData>
        </Card.Body>
      </Card>
    </Container>
  );
};

const InterfaceData = ({ data, type }) => {
  switch (type) {
    case 'properties':
      return <PropertyTree data={data} />;

    case 'datastream-object':
      return <ObjectTableList data={data} />;

    case 'datastream-individual':
      return <IndividualDatastreamTable data={data} />;

    default:
      // TODO autodetect interface type from data structure
      return null;
  }
};

const PropertyTree = ({ data }) => (
  <pre>
    <code>{JSON.stringify(data, null, 2)}</code>
  </pre>
);

const IndividualDatastreamTable = ({ data }) => {
  const paths = linearizePathTree('', data);

  if (paths.length === 0) {
    return <p>No data sent by the device.</p>;
  }

  return (
    <Table responsive>
      <thead>
        <tr>
          <th>Path</th>
          <th>Last value</th>
          <th>Last timestamp</th>
        </tr>
      </thead>
      <tbody>
        {paths.map(({ path, value, timestamp }) => (
          <IndividualDatastreamRow key={path} path={path} value={value} timestamp={timestamp} />
        ))}
      </tbody>
    </Table>
  );
};

const IndividualDatastreamRow = ({ path, value, timestamp }) => (
  <tr>
    <td>{path}</td>
    <td>{formatAstarteValue(value)}</td>
    <td>{new Date(timestamp).toLocaleString()}</td>
  </tr>
);

const ObjectDatastreamTable = ({ path, values }) => {
  const labels = [];
  const latestValues = values.slice(0, MAX_SHOWN_VALUES);

  Object.keys(values[0]).forEach((prop) => {
    if (prop !== 'timestamp') {
      labels.push(prop);
    }
  });

  return (
    <>
      <h5 className="mb-1">Path</h5>
      <p>{path || '/'}</p>
      <Table responsive>
        <thead>
          <tr>
            {labels.map((label) => (
              <th key={label}>{label}</th>
            ))}
            <th>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {latestValues.map((obj) => (
            <ObjectDatastreamRow key={obj.timestamp} labels={labels} obj={obj} />
          ))}
        </tbody>
      </Table>
    </>
  );
};

const ObjectDatastreamRow = ({ labels, obj }) => (
  <tr>
    {labels.map((label) => (
      <td key={label}>{formatAstarteValue(obj[label])}</td>
    ))}
    <td>{new Date(obj.timestamp).toLocaleString()}</td>
  </tr>
);

const ObjectTableList = ({ data }) => {
  const linearizedData = linearizePathTree('', data);

  if (linearizedData.length === 0) {
    return <p>No data sent by the device.</p>;
  }

  const dataByPath = _.groupBy(linearizedData, 'path');

  return Object.entries(dataByPath).map(([path, pathData]) => (
    <ObjectDatastreamTable key={path} path={path} values={pathData.map((d) => d.value)} />
  ));
};

export default DeviceInterfaceValues;
